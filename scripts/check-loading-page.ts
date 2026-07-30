import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'

/**
 * The dev server inlines a script into its loading page by serialising a
 * function with `toString()`. That only works while the built function stays
 * self-contained: a bundler that renamed a binding it referenced, or inlined it
 * into its call site, would emit a page that throws in the browser and nowhere
 * else, because nothing here imports it. This runs the built function to prove
 * it still stands alone.
 */
const distDir = resolve(process.cwd(), process.argv[2] ?? 'dist')
const CLIENTS = ['progressClient', 'recoveryClient']

function fail(message: string): never {
  console.error(`check-loading-page: ${message}`)
  process.exit(1)
}

/** The source of `function <name>(`, from its signature to its closing brace. */
function extract(source: string, name: string): string | undefined {
  const start = source.indexOf(`function ${name}(`)
  if (start === -1) {
    return undefined
  }
  let depth = 0
  for (let index = source.indexOf('{', start); index < source.length; index++) {
    if (source[index] === '{') {
      depth++
    }
    else if (source[index] === '}' && --depth === 0) {
      return source.slice(start, index + 1)
    }
  }
  return undefined
}

const chunks = (await readdir(distDir, { recursive: true })).filter(name => name.endsWith('.mjs'))
const sources = await Promise.all(chunks.map(name => readFile(resolve(distDir, name), 'utf8')))

for (const name of CLIENTS) {
  const source = sources.find(chunk => chunk.includes(`function ${name}(`))
  if (!source) {
    fail(`no chunk declares \`${name}\`; it was inlined or renamed, so \`toString()\` no longer emits it`)
  }

  const listeners: string[] = []
  const globals = {
    document: {
      title: '',
      documentElement: { style: { setProperty: () => {} } },
      body: { append: () => {}, classList: { add: () => {}, remove: () => {} } },
      createElement: () => ({ removeAttribute: () => {} }),
    },
    EventSource: class {
      close() {}
      addEventListener(type: string) {
        listeners.push(type)
      }
    },
    location: { href: 'http://localhost:3000/', reload: () => {} },
    fetch: () => Promise.resolve({ text: () => Promise.resolve('') }),
    // stubbed, or the client's own timers would keep this process alive
    setInterval: () => 0,
    clearInterval: () => {},
  }

  const client = extract(source, name)!
  try {
    // eslint-disable-next-line no-new-func
    new Function(...Object.keys(globals), `return (${client})`)(...Object.values(globals))({
      progressPath: '/__nuxt_dev__/progress',
      captionId: 'nuxt-dev-phase',
      progressProperty: '--nuxt-progress',
      elapsed: 0,
      pollInterval: 200,
    })
  }
  catch (error) {
    fail(`\`${name}\` does not run on its own: ${(error as Error).message}`)
  }

  if (!listeners.includes('nuxt:ready')) {
    fail(`\`${name}\` ran but subscribed to ${listeners.join(', ') || 'nothing'}`)
  }

  console.log(`check-loading-page: \`${name}\` runs standalone (${client.length} bytes, ${listeners.length} listeners)`)
}
