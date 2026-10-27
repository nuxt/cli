import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import os, { tmpdir } from 'node:os'
import process from 'node:process'
import v8 from 'node:v8'

import { join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { runInstall, answers, resolveModulePath, spawn, tinyexec, writeTypes, tty } = vi.hoisted(() => ({
  runInstall: vi.fn((_options: Record<string, unknown>) => Promise.resolve({ success: true, output: '', command: '', ignoredBuilds: [] as string[] })),
  answers: { select: [] as unknown[], confirm: [] as unknown[] },
  resolveModulePath: vi.fn(),
  spawn: vi.fn(),
  tinyexec: vi.fn(() => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })),
  writeTypes: vi.fn(() => Promise.resolve()),
  tty: { value: true },
}))

vi.mock('tinyexec', () => ({ x: tinyexec }))

vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn,
}))

vi.mock('exsolve', async importOriginal => ({
  ...await importOriginal<typeof import('exsolve')>(),
  resolveModulePath,
}))

vi.mock('../../../src/utils/install', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/utils/install')>(),
  runInstall,
}))

vi.mock('../../../src/utils/package-managers', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/utils/package-managers')>(),
  detectPackageManager: () => Promise.resolve({ name: 'pnpm', agent: 'pnpm' }),
}))

vi.mock('../../../src/utils/kit', () => ({
  loadKit: () => Promise.resolve({
    loadNuxt: () => Promise.resolve({ close: () => Promise.resolve(), options: {} }),
    buildNuxt: () => Promise.resolve(),
    writeTypes,
  }),
  tryResolveNuxt: () => undefined,
}))

vi.mock('std-env', async importOriginal => ({
  ...await importOriginal<typeof import('std-env')>(),
  get hasTTY() {
    return tty.value
  },
}))

vi.mock('@clack/prompts', async (importOriginal) => {
  const original = await importOriginal<typeof import('@clack/prompts')>()
  const next = (queue: unknown[], fallback: unknown) => Promise.resolve(queue.length ? queue.shift() : fallback)
  return {
    ...original,
    select: vi.fn(() => next(answers.select, 'vue-tsc')),
    confirm: vi.fn(() => next(answers.confirm, false)),
    spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), error: vi.fn(), message: vi.fn() })),
  }
})

const { runCommandDef } = await import('../../../src/run-command')
const { render, screen } = await import('../../utils/terminal')
const typecheck = await import('../../../src/commands/typecheck').then(r => r.default)

let cwd: string

/** Pretend the named packages are installed in the project. */
function installed(...names: string[]): void {
  resolveModulePath.mockImplementation((id: string) => {
    if (names.some(name => id === name || id.startsWith(`${name}/`))) {
      return join(cwd, 'node_modules', id)
    }
    return undefined
  })
}

/** Make the type generation process exit with the given code or signal. */
function typegenExits(code: number | null, signal: NodeJS.Signals | null = null): void {
  spawn.mockImplementation(() => {
    const child = new EventEmitter()
    setImmediate(() => child.emit('exit', code, signal))
    return child
  })
}

async function runTypecheck(argv: string[] = [], data?: { overrides?: Record<string, any> }): Promise<{ output: string, exitCode: number | undefined }> {
  process.exitCode = undefined
  const renderer = await render(async () => {
    await runCommandDef(typecheck, [`--cwd=${cwd}`, ...argv], data)
  })
  const exitCode = process.exitCode as number | undefined
  process.exitCode = 0
  return { output: `${renderer.frames.join('\n')}\n${screen(renderer)}`, exitCode }
}

/** A checker process killed by `signal` before it could exit. */
function killed(signal: string) {
  return Object.assign(Promise.resolve({ exitCode: undefined as unknown as number, stdout: '', stderr: '' }), { signalCode: signal })
}

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'nuxt-typecheck-'))
  answers.select.length = 0
  answers.confirm.length = 0
  tty.value = true
  vi.clearAllMocks()
  tinyexec.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
  typegenExits(0)
  runInstall.mockImplementation(() => Promise.resolve({ success: true, output: '', command: '', ignoredBuilds: [] as string[] }))
  installed('typescript', 'vue-tsc/bin/vue-tsc.js')
  await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: 'app', type: 'module' }))
})

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('typecheck checker selection', () => {
  it('should reject a checker it does not know', async () => {
    const { output, exitCode } = await runTypecheck(['--checker=tsc'])

    expect(exitCode).toBe(1)
    expect(output).toContain('Unknown type checker')
    expect(output).toContain('vue-tsc')
    expect(tinyexec).not.toHaveBeenCalled()
  })

  it('should run the checker that is installed', async () => {
    await runTypecheck()

    expect(tinyexec).toHaveBeenCalledWith(expect.stringContaining('vue-tsc'), ['--noEmit'], expect.objectContaining({
      nodeOptions: expect.objectContaining({ cwd }),
    }))
  })

  it('should prefer golar when the project has a golar config', async () => {
    await writeFile(join(cwd, 'golar.config.ts'), 'export default {}')
    await mkdir(join(cwd, 'node_modules/golar'), { recursive: true })
    await writeFile(join(cwd, 'node_modules/golar/package.json'), JSON.stringify({ name: 'golar', bin: './bin.js' }))
    installed('typescript', 'vue-tsc/bin/vue-tsc.js', 'golar/unstable', '@golar/vue')

    await runTypecheck()

    expect(tinyexec).toHaveBeenCalledWith(expect.stringContaining('golar'), ['tsc', '--noEmit'], expect.anything())
  })

  it('should create a golar config the first time golar is used', async () => {
    await mkdir(join(cwd, 'node_modules/golar'), { recursive: true })
    await writeFile(join(cwd, 'node_modules/golar/package.json'), JSON.stringify({ name: 'golar', bin: './bin.js' }))
    installed('golar/unstable', '@golar/vue')

    await runTypecheck(['--checker=golar'])

    expect(await readFile(join(cwd, 'golar.config.ts'), 'utf8')).toContain('defineConfig')
  })
})

describe('typecheck installation advice', () => {
  it('should offer to install a missing checker and run it afterwards', async () => {
    installed()
    answers.select.push('vue-tsc')
    answers.confirm.push(true)
    runInstall.mockImplementation(() => {
      installed('typescript', 'vue-tsc/bin/vue-tsc.js')
      return Promise.resolve({ success: true, output: '', command: '', ignoredBuilds: [] as string[] })
    })

    await runTypecheck()

    expect(runInstall).toHaveBeenCalledWith(expect.objectContaining({ cwd, dependencies: ['typescript', 'vue-tsc'], dev: true }))
    expect(tinyexec).toHaveBeenCalledTimes(1)
  })

  it('should print the install command when the user declines', async () => {
    installed()
    answers.select.push('vue-tsc')
    answers.confirm.push(false)

    const { output, exitCode } = await runTypecheck()

    expect(exitCode).toBe(1)
    expect(output).toContain('pnpm add -D typescript vue-tsc')
    expect(tinyexec).not.toHaveBeenCalled()
  })

  it('should explain when the checker is still missing after installing', async () => {
    installed()
    answers.select.push('vue-tsc')
    answers.confirm.push(true)

    const { output, exitCode } = await runTypecheck()

    expect(exitCode).toBe(1)
    expect(output).toContain('Failed to resolve')
    expect(tinyexec).not.toHaveBeenCalled()
  })
})

describe('typecheck build mode', () => {
  it('should use project references for a solution-style tsconfig', async () => {
    await writeFile(join(cwd, 'tsconfig.json'), JSON.stringify({ files: [], references: [{ path: './.nuxt/tsconfig.app.json' }] }))

    await runTypecheck()

    expect(tinyexec).toHaveBeenCalledWith(expect.anything(), ['-b', '--noEmit'], expect.anything())
  })

  it('should warn when a tsconfig references nuxt projects but has files of its own', async () => {
    await writeFile(join(cwd, 'tsconfig.json'), JSON.stringify({
      include: ['src'],
      references: [{ path: './.nuxt/tsconfig.app.json' }],
    }))

    const { output } = await runTypecheck()

    expect(output).toContain('"files": []')
    expect(tinyexec).toHaveBeenCalledWith(expect.anything(), ['--noEmit'], expect.anything())
  })

  it('should let `--build` override the detection', async () => {
    await runTypecheck(['--build'])

    expect(tinyexec).toHaveBeenCalledWith(expect.anything(), ['-b', '--noEmit'], expect.anything())
  })
})

describe('typecheck results', () => {
  it('should report a passing type check', async () => {
    const { output, exitCode } = await runTypecheck()

    expect(output).toContain('Type check passed')
    expect(exitCode).toBeFalsy()
  })

  it('should carry the checker exit code through', async () => {
    tinyexec.mockResolvedValue({ exitCode: 2, stdout: '', stderr: '' })

    const { output, exitCode } = await runTypecheck()

    expect(output).toContain('Type check failed')
    expect(exitCode).toBe(2)
  })

  it('should report a checker killed by the OOM killer', async () => {
    tinyexec.mockReturnValueOnce(killed('SIGKILL'))

    const { output, exitCode } = await runTypecheck()

    expect(output).toContain('Type-checking was killed by SIGKILL')
    expect(output).toContain('out of memory')
    expect(output).not.toContain('Type check failed')
    expect(exitCode).toBe(137)
  })

  it('should treat SIGABRT as running out of memory', async () => {
    tinyexec.mockReturnValueOnce(killed('SIGABRT'))

    const { output, exitCode } = await runTypecheck()

    expect(output).toContain('was killed by SIGABRT')
    expect(output).toContain('out of memory')
    expect(exitCode).toBe(128 + os.constants.signals.SIGABRT)
  })

  it('should report other signals without an out of memory hint', async () => {
    tinyexec.mockReturnValueOnce(killed('SIGTERM'))

    const { output, exitCode } = await runTypecheck()

    expect(output).toContain('was killed by SIGTERM')
    expect(output).not.toContain('out of memory')
    expect(exitCode).toBe(143)
  })

  it('should report a killed checker without a TTY', async () => {
    tty.value = false
    tinyexec.mockReturnValueOnce(killed('SIGKILL'))

    const { output, exitCode } = await runTypecheck()

    expect(output).toContain('was killed by SIGKILL')
    expect(exitCode).toBe(137)
  })
})

describe('typecheck heap limit', () => {
  const MB = 1024 ** 2
  const GB = 1024 ** 3
  const execArgv = process.execArgv

  function memory({ total = 12 * GB, constrained = 2 ** 64, available = 10 * GB, heapLimit = 2240 * MB } = {}) {
    vi.spyOn(os, 'totalmem').mockReturnValue(total)
    vi.spyOn(process, 'constrainedMemory').mockReturnValue(constrained)
    vi.spyOn(process, 'availableMemory').mockReturnValue(available)
    vi.spyOn(v8, 'getHeapStatistics').mockReturnValue({ ...v8.getHeapStatistics(), heap_size_limit: heapLimit })
  }

  function checkerNodeOptions(): string | undefined {
    const options = (tinyexec.mock.calls[0] as unknown[])[2] as { nodeOptions: { env?: Record<string, string> } }
    return options.nodeOptions.env?.NODE_OPTIONS
  }

  beforeEach(() => {
    vi.stubEnv('NODE_OPTIONS', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    process.execArgv = execArgv
  })

  it.each([
    ['half of the total memory', {}, 6144],
    ['half of the memory limit of the process', { constrained: 6 * GB }, 3072],
    ['the memory currently available', { available: 3 * GB }, 3072],
    ['at most 8 GB', { total: 32 * GB, available: 30 * GB, heapLimit: 4144 * MB }, 8192],
  ])('should raise the checker heap limit to %s', async (_, options, limit) => {
    memory(options)

    await runTypecheck()

    expect(checkerNodeOptions()).toBe(`--max-old-space-size=${limit}`)
  })

  it('should keep existing node options', async () => {
    memory()
    vi.stubEnv('NODE_OPTIONS', '--enable-source-maps')

    await runTypecheck()

    expect(checkerNodeOptions()).toBe('--enable-source-maps --max-old-space-size=6144')
  })

  it('should pass on a heap limit set for the nuxt process', async () => {
    memory()
    process.execArgv = ['--max-old-space-size=3000']

    await runTypecheck()

    expect(checkerNodeOptions()).toBe('--max-old-space-size=3000')
  })

  it.each([
    ['the raised heap limit', {}, '', 6144, '--max-old-space-size=6144'],
    ['the heap limit set in NODE_OPTIONS', {}, '--max-old-space-size=3000', 3000, undefined],
    ['V8\'s default heap limit', { total: 4 * GB }, '', 2240, undefined],
  ])('should name %s when the checker runs out of heap', async (_, options, nodeOptions, limit, passed) => {
    memory(options)
    vi.stubEnv('NODE_OPTIONS', nodeOptions)
    tinyexec.mockReturnValueOnce(killed('SIGABRT'))

    const { output } = await runTypecheck()

    expect(checkerNodeOptions()).toBe(passed)
    expect(output).toContain(`Its heap was limited to ${limit} MB`)
    expect(output).toContain('NODE_OPTIONS=--max-old-space-size=<MB>')
  })

  it('should leave the heap limit of golar alone', async () => {
    memory()
    await mkdir(join(cwd, 'node_modules/golar'), { recursive: true })
    await writeFile(join(cwd, 'node_modules/golar/package.json'), JSON.stringify({ name: 'golar', bin: './bin.js' }))
    installed('golar/unstable', '@golar/vue')
    tinyexec.mockReturnValueOnce(killed('SIGABRT'))

    const { output } = await runTypecheck(['--checker=golar'])

    expect(checkerNodeOptions()).toBeUndefined()
    expect(output).toContain('out of memory')
    expect(output).not.toContain('heap was limited')
  })
})

describe('typecheck type generation', () => {
  it('should generate types in a separate node process', async () => {
    await runTypecheck(['--dotenv=.env.test', '--logLevel=silent', '--extends=./layer'])

    expect(spawn).toHaveBeenCalledWith(process.execPath, [expect.stringMatching(/write-types\.mjs$/), expect.any(String)], expect.objectContaining({ cwd, stdio: 'inherit' }))
    expect(JSON.parse(spawn.mock.calls[0]![1][1])).toEqual({
      cwd,
      dotenv: ['.env.test'],
      logLevel: 'silent',
      overrides: { extends: ['./layer'] },
    })
    expect(writeTypes).not.toHaveBeenCalled()
    expect(tinyexec).toHaveBeenCalledTimes(1)
  })

  it('should fail without type-checking when generating types fails', async () => {
    typegenExits(1)

    await expect(runTypecheck()).rejects.toThrow('Generating types failed with exit code 1')
    expect(tinyexec).not.toHaveBeenCalled()
  })

  it('should report the signal that terminated type generation', async () => {
    typegenExits(null, 'SIGKILL')

    await expect(runTypecheck()).rejects.toThrow('Generating types was terminated by SIGKILL')
    expect(tinyexec).not.toHaveBeenCalled()
  })

  it('should generate types in this process when called with overrides', async () => {
    await runTypecheck([], { overrides: { hooks: { ready: () => {} } } })

    expect(spawn).not.toHaveBeenCalled()
    expect(writeTypes).toHaveBeenCalledTimes(1)
    expect(tinyexec).toHaveBeenCalledTimes(1)
  })
})

describe('typecheck incremental cache', () => {
  const vueTscKey = 'vue-tsc@3.3.10+typescript@6.0.3'

  /** Pretend the named packages are installed with the given versions and entry files. */
  async function installedPackages(packages: Record<string, { version: string, entries: string[] }>): Promise<void> {
    const entries = new Map<string, string>()
    for (const [name, { version, entries: ids }] of Object.entries(packages)) {
      const dir = join(cwd, 'node_modules', name)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name, version, bin: './bin.js' }))
      for (const id of ids) {
        entries.set(id, join(dir, id.slice(name.length + 1) || 'index.js'))
      }
    }
    resolveModulePath.mockImplementation((id: string) => entries.get(id))
  }

  function installedVueTsc(version = '3.3.10') {
    return installedPackages({
      'typescript': { version: '6.0.3', entries: ['typescript'] },
      'vue-tsc': { version, entries: ['vue-tsc/bin/vue-tsc.js'] },
    })
  }

  async function writeFixture(path: string, contents: unknown) {
    await mkdir(join(cwd, path, '..'), { recursive: true })
    await writeFile(join(cwd, path), typeof contents === 'string' ? contents : JSON.stringify(contents))
  }

  async function writeProjects() {
    await writeFixture('tsconfig.json', { files: [], references: [{ path: './.nuxt/tsconfig.app.json' }, { path: './layer' }] })
    await writeFixture('.nuxt/tsconfig.app.json', { compilerOptions: { tsBuildInfoFile: './cache/typecheck/tsconfig.app.tsbuildinfo' } })
    await writeFixture('layer/tsconfig.json', { compilerOptions: { tsBuildInfoFile: '../.nuxt/cache/typecheck/layer.tsbuildinfo' } })
  }

  it('should type-check incrementally when every referenced project sets `tsBuildInfoFile`', async () => {
    await installedVueTsc()
    await writeProjects()

    await runTypecheck()

    expect(tinyexec).toHaveBeenCalledWith(expect.anything(), ['-b', '--noEmit', '--incremental'], expect.anything())
  })

  it('should mark the referenced configs as newer than their build info', async () => {
    await installedVueTsc()
    await writeProjects()
    await utimes(join(cwd, '.nuxt/tsconfig.app.json'), 0, 0)

    await runTypecheck()

    expect((await stat(join(cwd, '.nuxt/tsconfig.app.json'))).mtimeMs).toBeGreaterThan(0)
  })

  it('should discard build info written by a different checker', async () => {
    const stamp = join(cwd, '.nuxt/cache/typecheck/checker.stamp')
    const buildInfo = '.nuxt/cache/typecheck/tsconfig.app.tsbuildinfo'
    await installedVueTsc('3.3.9')
    await writeProjects()
    await writeFixture(buildInfo, '{}')
    await runTypecheck()
    expect(await readFile(stamp, 'utf8')).toBe('vue-tsc@3.3.9+typescript@6.0.3')

    await writeFixture(buildInfo, '{}')
    await runTypecheck()
    expect(await readFile(join(cwd, buildInfo), 'utf8')).toBe('{}')

    await installedVueTsc()
    await runTypecheck()
    await expect(stat(join(cwd, buildInfo))).rejects.toThrow()
    expect(await readFile(stamp, 'utf8')).toBe(vueTscKey)
  })

  it('should remove the build info with `--no-incremental`', async () => {
    const buildInfo = '.nuxt/cache/typecheck/tsconfig.app.tsbuildinfo'
    await installedVueTsc()
    await writeProjects()
    await writeFixture(buildInfo, '{}')

    await runTypecheck(['--no-incremental'])

    expect(tinyexec).toHaveBeenCalledWith(expect.anything(), ['-b', '--noEmit'], expect.anything())
    await expect(stat(join(cwd, buildInfo))).rejects.toThrow()
  })

  it('should leave the build info alone when the checker version cannot be read', async () => {
    const buildInfo = '.nuxt/cache/typecheck/tsconfig.app.tsbuildinfo'
    await writeProjects()
    await writeFixture(buildInfo, '{}')

    await runTypecheck()

    expect(tinyexec).toHaveBeenCalledWith(expect.anything(), ['-b', '--noEmit'], expect.anything())
    expect(await readFile(join(cwd, buildInfo), 'utf8')).toBe('{}')
  })

  it('should type-check without the cache when a checker manifest cannot be parsed', async () => {
    await installedVueTsc()
    await writeProjects()
    await writeFixture('node_modules/vue-tsc/package.json', '{')

    const { exitCode } = await runTypecheck()

    expect(exitCode).toBeFalsy()
    expect(tinyexec).toHaveBeenCalledWith(expect.anything(), ['-b', '--noEmit'], expect.anything())
  })

  it('should key the golar cache by golar and its vue plugin', async () => {
    await installedPackages({
      'golar': { version: '0.1.11', entries: ['golar/unstable'] },
      '@golar/vue': { version: '0.1.12', entries: ['@golar/vue'] },
    })
    await writeProjects()

    await runTypecheck(['--checker=golar'])

    expect(tinyexec).toHaveBeenCalledWith(expect.anything(), ['tsc', '--build', '--noEmit', '--incremental'], expect.anything())
    expect(await readFile(join(cwd, '.nuxt/cache/typecheck/checker.stamp'), 'utf8')).toBe('golar@0.1.11+@golar/vue@0.1.12')
  })
})
