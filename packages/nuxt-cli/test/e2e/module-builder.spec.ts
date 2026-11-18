import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { x } from 'tinyexec'
import { afterEach, describe, expect, it } from 'vitest'

const nuxi = fileURLToPath(new URL('../../bin/nuxi.mjs', import.meta.url))
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function createModule({ withBuilder, installed = [] }: { withBuilder: boolean, installed?: string[] }) {
  const parent = await mkdtemp(join(tmpdir(), 'nuxt-module-builder-'))
  tempDirs.push(parent)
  const rootDir = join(parent, 'my-module')
  await mkdir(rootDir)
  await writeFile(join(rootDir, 'package.json'), JSON.stringify({ name: 'my-module' }))

  if (withBuilder) {
    // Stands in for `@nuxt/module-builder`: prints what it was run with, and
    // exits with a code the CLI has to pass on.
    const packageDir = join(rootDir, 'node_modules/@nuxt/module-builder')
    await mkdir(packageDir, { recursive: true })
    await writeFile(join(packageDir, 'package.json'), JSON.stringify({
      name: '@nuxt/module-builder',
      bin: { 'nuxt-build-module': './cli.mjs', 'nuxt-module-build': './cli.mjs' },
      exports: { './package.json': './package.json' },
      peerDependencies: { tsdown: '^0.23.7', typescript: '^5.9.3 || ^6.0.0' },
    }))
    await writeFile(join(packageDir, 'cli.mjs'), 'console.log(JSON.stringify(process.argv.slice(2))); process.exit(3)')
  }

  for (const name of installed) {
    const packageDir = join(rootDir, 'node_modules', name)
    await mkdir(packageDir, { recursive: true })
    await writeFile(join(packageDir, 'package.json'), JSON.stringify({ name, main: './index.js' }))
    await writeFile(join(packageDir, 'index.js'), '')
  }

  return { parent, rootDir }
}

function run(args: string[], cwd: string) {
  return x('node', [nuxi, ...args], {
    // `pnpm` points `NODE_PATH` at this repository's dependencies, which include `tsdown`.
    nodeOptions: { cwd, env: { ...process.env, NO_COLOR: '1', CI: '1', NODE_PATH: '' } },
  })
}

describe('nuxt module build', () => {
  it('forwards every argument, including a --cwd passed before the command', { timeout: 60_000 }, async () => {
    const { parent } = await createModule({ withBuilder: true, installed: ['tsdown', 'typescript'] })

    // `--unknown` takes a value the CLI cannot know about, so it must not be
    // read as ROOTDIR.
    const res = await run(['--cwd', 'my-module', 'module', 'build', '--unknown', 'value', '--sourcemap'], parent)

    expect(res.exitCode).toBe(3)
    const forwarded = JSON.parse(res.stdout.trim().split('\n').at(-1)!)
    expect(forwarded).toEqual(['build', '--cwd', 'my-module', '--unknown', 'value', '--sourcemap'])
  })

  it('prints the install command when the module builder is missing', { timeout: 60_000 }, async () => {
    const { rootDir } = await createModule({ withBuilder: false })

    const res = await run(['module', 'prepare'], rootDir)

    expect(res.exitCode).toBe(1)
    expect(res.stdout + res.stderr).toContain('nuxt module prepare needs @nuxt/module-builder, which is not installed in this module. Install it with npm i -D @nuxt/module-builder.')
  })

  it('prints the install command for missing peers at the range the builder declares', { timeout: 60_000 }, async () => {
    const { rootDir } = await createModule({ withBuilder: true, installed: ['typescript'] })

    const res = await run(['module', 'build'], rootDir)

    expect(res.exitCode).toBe(1)
    expect(res.stdout + res.stderr).toContain('nuxt module build needs tsdown, which is not installed in this module. Install it with npm i -D tsdown@^0.23.7.')
  })
})
