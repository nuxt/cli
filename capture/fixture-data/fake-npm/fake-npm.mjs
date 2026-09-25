// Stands in for the package manager while recording the module auto-install
// capture, so the recording needs no network and the fixture app is left
// unchanged. It sleeps long enough for the install task to be seen ticking,
// then materialises each requested package as a stub Nuxt module and records
// it in `package.json`, which is what the rest of `module add` (config entry,
// reload) needs to have happened.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const SUBCOMMANDS = new Set(['install', 'i', 'add'])
const specs = process.argv.slice(2).filter(arg => !arg.startsWith('-') && !SUBCOMMANDS.has(arg))

await new Promise(resolve => setTimeout(resolve, 2200))

for (const spec of specs) {
  const at = spec.lastIndexOf('@')
  const name = at > 0 ? spec.slice(0, at) : spec
  const version = at > 0 ? spec.slice(at + 1).replace(/^[~^]/, '') : '0.0.0'

  const dir = join('node_modules', ...name.split('/'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({
    name,
    version,
    type: 'module',
    main: './module.mjs',
  }, null, 2)}\n`)
  writeFileSync(join(dir, 'module.mjs'), [
    'import { defineNuxtModule } from \'@nuxt/kit\'',
    '',
    `export default defineNuxtModule({ meta: { name: ${JSON.stringify(name)}, version: ${JSON.stringify(version)} }, setup() {} })`,
    '',
  ].join('\n'))

  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  pkg.dependencies = { ...pkg.dependencies, [name]: `^${version}` }
  writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`)
}

console.log(`\nadded ${specs.length} package${specs.length === 1 ? '' : 's'} in 2s`)
