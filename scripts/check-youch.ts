import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

/**
 * `youch` cannot be bundled: it reads its own stylesheets and client scripts off
 * disk relative to `import.meta.url`. The build traces it into
 * `dist/node_modules` instead, which a bundler change could silently undo, so
 * this asserts the built output can still render an error page.
 */
const entry = resolve(process.cwd(), process.argv[2] ?? 'dist/index.mjs')

function fail(message: string): never {
  console.error(`check-youch: ${message}`)
  process.exit(1)
}

const { Youch } = await import(pathToFileURL(createRequire(pathToFileURL(entry)).resolve('youch')).href)

const html: string = await new Youch().toHTML(new Error('check-youch smoke test')).catch((error: NodeJS.ErrnoException) => {
  fail(`rendering the error page failed: ${error.code ?? ''} ${error.message}`)
})

if (!html.includes('check-youch smoke test')) {
  fail('the rendered error page does not contain the error message')
}

if (!html.includes('<style')) {
  fail('the rendered error page is missing its stylesheets')
}

console.log(`check-youch: error page renders (${html.length} bytes)`)
