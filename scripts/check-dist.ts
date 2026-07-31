import type { PackagingContract } from './tsdown.ts'

import { readFileSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { parseSync } from 'rolldown/utils'

/**
 * Assert the built output of the package in the current directory still matches
 * the `packaging` contract exported from its `tsdown.config.ts`.
 *
 * Resolution deliberately starts from the emitted entry, matching how the
 * bundle's own imports are resolved at runtime.
 */
const packageDir = process.cwd()
const entry = resolve(packageDir, process.argv[2] ?? 'dist/index.mjs')
const distDir = dirname(entry)

function fail(message: string): never {
  console.error(`check-dist: ${message}`)
  process.exit(1)
}

const { packaging = {} } = await import(pathToFileURL(resolve(packageDir, 'tsdown.config.ts')).href) as { packaging?: PackagingContract }

await import(pathToFileURL(entry).href).catch((error: NodeJS.ErrnoException) => {
  fail(`importing ${relative(packageDir, entry)} failed: ${error.code ?? ''} ${error.message}`)
})

const require = createRequire(pathToFileURL(entry))

for (const name of packaging.traced ?? []) {
  let resolved: string
  try {
    resolved = require.resolve(name)
  }
  catch {
    fail(`\`${name}\` does not resolve from ${relative(packageDir, entry)}`)
  }

  // Without this the check passes on a devDependency higher up the tree, which
  // is exactly the packaging mistake it exists to catch.
  if (!resolved.startsWith(distDir)) {
    fail(`\`${name}\` resolved to ${resolved}, outside ${distDir}; it was not traced into \`dist/node_modules\``)
  }
}

/** Specifiers a module pulls in eagerly, i.e. everything but `import()`. */
function staticModuleRequests(path: string, source: string): string[] {
  const { module } = parseSync(path, source)
  return [
    ...module.staticImports.map(entry => entry.moduleRequest.value),
    ...module.staticExports.flatMap(statement => statement.entries.flatMap(entry => entry.moduleRequest ? [entry.moduleRequest.value] : [])),
  ]
}

/**
 * Every chunk reachable from `from` through static imports, mapped to the bare
 * specifiers it imports statically.
 */
function collectStaticImports(from: string, seen = new Map<string, Set<string>>()): Map<string, Set<string>> {
  if (seen.has(from)) {
    return seen
  }
  const bare = new Set<string>()
  seen.set(from, bare)

  let source: string
  try {
    source = readFileSync(from, 'utf8')
  }
  catch {
    return seen
  }

  for (const specifier of staticModuleRequests(from, source)) {
    if (specifier.startsWith('.')) {
      collectStaticImports(resolve(dirname(from), specifier), seen)
    }
    else {
      bare.add(specifier)
    }
  }

  return seen
}

const chunks = (await readdir(distDir, { recursive: true, withFileTypes: true }))
  .filter(entry => entry.isFile() && entry.name.endsWith('.mjs') && !resolve(entry.parentPath, entry.name).includes(`${sep}node_modules${sep}`))
  .map(entry => resolve(entry.parentPath, entry.name))

const sources = await Promise.all(chunks.map(path => readFile(path, 'utf8')))
for (const specifier of packaging.external ?? []) {
  if (!sources.some(source => source.includes(`"${specifier}"`) || source.includes(`'${specifier}'`))) {
    fail(`no chunk imports \`${specifier}\` as an external specifier; it was bundled or dropped`)
  }
}

for (const [entryPath, specifiers] of Object.entries(packaging.lazy ?? {})) {
  const lazyEntry = resolve(packageDir, entryPath)
  const eager = collectStaticImports(lazyEntry)
  for (const specifier of specifiers) {
    const importer = [...eager].find(([, imported]) => imported.has(specifier))
    if (importer) {
      fail(`\`${specifier}\` is statically imported by ${relative(distDir, importer[0])}, which is reachable from ${entryPath}; it should only be reached through a dynamic import`)
    }
  }
}

console.log(`check-dist: ${relative(packageDir, entry)} imports cleanly; ${packaging.traced?.length ?? 0} traced dependencies, ${packaging.external?.length ?? 0} external specifiers across ${chunks.length} chunks`)
