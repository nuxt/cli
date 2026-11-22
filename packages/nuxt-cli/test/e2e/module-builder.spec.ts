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

async function createModule({ withBuilder, bin = 'nuxt-module-build' }: { withBuilder: boolean, bin?: string }) {
  const parent = await mkdtemp(join(tmpdir(), 'nuxt-module-builder-'))
  tempDirs.push(parent)
  const rootDir = join(parent, 'my-module')
  await mkdir(rootDir)
  await writeFile(join(rootDir, 'package.json'), JSON.stringify({ name: 'my-module' }))

  if (withBuilder) {
    const packageDir = join(rootDir, 'node_modules/@nuxt/module-builder')
    await mkdir(packageDir, { recursive: true })
    await writeFile(join(packageDir, 'package.json'), JSON.stringify({
      name: '@nuxt/module-builder',
      bin: { [bin]: './cli.mjs' },
      exports: { './package.json': './package.json' },
    }))
    await writeFile(join(packageDir, 'cli.mjs'), 'console.log(JSON.stringify(process.argv.slice(2))); process.exit(3)')
  }

  return { parent, rootDir }
}

function run(args: string[], cwd: string) {
  return x('node', [nuxi, ...args], {
    nodeOptions: {
      cwd,
      env: {
        ...process.env,
        NODE_PATH: undefined,
        NO_COLOR: '1',
        FORCE_COLOR: '0',
        CI: '1',
      },
    },
  })
}

describe('nuxt module build', () => {
  it('forwards every argument, including a --cwd passed before the command', { timeout: 60_000 }, async () => {
    const { parent } = await createModule({ withBuilder: true })

    const res = await run([
      '--cwd',
      'my-module',
      'module',
      'build',
      '--unknown',
      'value',
      '--sourcemap',
    ], parent)

    expect(res.exitCode).toBe(3)
    const forwarded = JSON.parse(res.stdout.trim().split('\n').at(-1)!)
    expect(forwarded).toEqual([
      'build',
      '--cwd',
      'my-module',
      '--unknown',
      'value',
      '--sourcemap',
    ])
  })

  it('resolves the module builder from ROOTDIR', { timeout: 60_000 }, async () => {
    const { parent } = await createModule({ withBuilder: true })

    const res = await run(['module', 'prepare', 'my-module'], parent)

    expect(res.exitCode).toBe(3)
    const forwarded = JSON.parse(res.stdout.trim().split('\n').at(-1)!)
    expect(forwarded).toEqual(['prepare', 'my-module'])
  })

  it('reports a missing module builder', { timeout: 60_000 }, async () => {
    const { rootDir } = await createModule({ withBuilder: false })

    const res = await run(['module', 'prepare'], rootDir)

    expect(res.exitCode).toBe(1)
    expect(res.stdout + res.stderr).toContain('`@nuxt/module-builder` is not installed in this module. Install it as a development dependency to use `nuxt module prepare`.')
  })

  it('reports a module builder without the nuxt-module-build binary', { timeout: 60_000 }, async () => {
    const { rootDir } = await createModule({ withBuilder: true, bin: 'nuxt-build-module' })

    const res = await run(['module', 'build'], rootDir)

    expect(res.exitCode).toBe(1)
    expect(res.stdout + res.stderr).toContain('The installed version of `@nuxt/module-builder` does not support `nuxt module build`.')
  })
})
