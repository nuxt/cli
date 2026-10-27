import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import process from 'node:process'

import { join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { runInstall, answers, resolveModulePath, spawn, tinyexec, writeTypes } = vi.hoisted(() => ({
  runInstall: vi.fn((_options: Record<string, unknown>) => Promise.resolve({ success: true, output: '', command: '', ignoredBuilds: [] as string[] })),
  answers: { select: [] as unknown[], confirm: [] as unknown[] },
  resolveModulePath: vi.fn(),
  spawn: vi.fn(),
  tinyexec: vi.fn(() => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })),
  writeTypes: vi.fn(() => Promise.resolve()),
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
  hasTTY: true,
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

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'nuxt-typecheck-'))
  answers.select.length = 0
  answers.confirm.length = 0
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
