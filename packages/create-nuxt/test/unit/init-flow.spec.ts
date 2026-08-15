import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import process from 'node:process'

import { join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const CANCELLED = Symbol('cancelled')

const {
  answers,
  downloadTemplate,
  fetchModules,
  getTemplates,
  runInstall,
  startShell,
  tinyexec,
} = vi.hoisted(() => ({
  answers: { select: [] as unknown[], text: [] as unknown[], confirm: [] as unknown[] },
  downloadTemplate: vi.fn(),
  fetchModules: vi.fn(() => Promise.resolve([])),
  getTemplates: vi.fn(),
  runInstall: vi.fn(),
  startShell: vi.fn(),
  tinyexec: vi.fn(() => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })),
}))

vi.mock('std-env', async importOriginal => ({
  ...await importOriginal<typeof import('std-env')>(),
  hasTTY: true,
}))

vi.mock('giget', () => ({ downloadTemplate, startShell }))
vi.mock('tinyexec', () => ({ x: tinyexec }))

vi.mock('@clack/prompts', async (importOriginal) => {
  const original = await importOriginal<typeof import('@clack/prompts')>()
  const next = (queue: unknown[], fallback: unknown) => Promise.resolve(queue.length ? queue.shift() : fallback)
  return {
    ...original,
    intro: vi.fn(),
    outro: vi.fn(),
    cancel: vi.fn(),
    note: vi.fn(),
    isCancel: (value: unknown) => value === CANCELLED || original.isCancel(value),
    select: vi.fn(() => next(answers.select, undefined)),
    text: vi.fn(() => next(answers.text, '')),
    confirm: vi.fn(() => next(answers.confirm, false)),
    spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), error: vi.fn(), message: vi.fn() })),
  }
})

vi.mock('../../../nuxt-cli/src/utils/starter-templates', async importOriginal => ({
  ...await importOriginal<typeof import('../../../nuxt-cli/src/utils/starter-templates')>(),
  getTemplates,
}))

vi.mock('../../../nuxt-cli/src/commands/module/_utils', async importOriginal => ({
  ...await importOriginal<typeof import('../../../nuxt-cli/src/commands/module/_utils')>(),
  fetchModules,
}))

vi.mock('../../../nuxt-cli/src/utils/install', async importOriginal => ({
  ...await importOriginal<typeof import('../../../nuxt-cli/src/utils/install')>(),
  runInstall,
}))

const { runCommandDef } = await import('../../../nuxt-cli/src/run-command')
const { render, screen } = await import('../../../nuxt-cli/test/utils/terminal')
const initCommand = await import('../../src/init').then(r => r.default)

let cwd: string

class ExitError extends Error {
  constructor(readonly code: number | undefined) {
    super(`process.exit(${code})`)
  }
}

async function runInit(argv: string[]): Promise<{ output: string, exitCode: number | undefined }> {
  let exitCode: number | undefined
  const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
    exitCode = code as number | undefined
    throw new ExitError(exitCode)
  })

  const renderer = await render(async () => {
    await runCommandDef(initCommand, [`--cwd=${cwd}`, ...argv]).catch((error) => {
      if (!(error instanceof ExitError)) {
        throw error
      }
    })
  })

  exit.mockRestore()
  return { output: `${renderer.frames.join('\n')}\n${screen(renderer)}`, exitCode }
}

/** Write the files `downloadTemplate` would have unpacked. */
function stubTemplate(files: Record<string, string> = {}, name = 'minimal') {
  downloadTemplate.mockImplementation(async (_template: string, options: { dir: string }) => {
    await mkdir(options.dir, { recursive: true })
    await writeFile(join(options.dir, 'package.json'), JSON.stringify({ name: 'template', dependencies: { nuxt: '^4.0.0' } }, null, 2))
    for (const [file, contents] of Object.entries(files)) {
      await mkdir(join(options.dir, file, '..'), { recursive: true })
      await writeFile(join(options.dir, file), contents)
    }
    return { dir: options.dir, name, source: 'github' }
  })
}

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'nuxt-init-flow-'))
  answers.select.length = 0
  answers.text.length = 0
  answers.confirm.length = 0
  vi.clearAllMocks()
  stubTemplate()
  getTemplates.mockResolvedValue({
    minimal: { name: 'minimal', description: 'Minimal starter', defaultDir: 'nuxt-app', url: '', tar: '' },
    v4: { name: 'v4', description: 'Nuxt 4 starter', defaultDir: 'nuxt-app', url: '', tar: '' },
  })
  runInstall.mockResolvedValue({ success: true, output: '', command: 'npm install', ignoredBuilds: [] })
  fetchModules.mockResolvedValue([])
})

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true })
  process.exitCode = 0
  vi.restoreAllMocks()
})

describe('interactive scaffolding', () => {
  it('should scaffold from the answers it was given', async () => {
    answers.select.push('minimal', 'npm')
    answers.text.push('my-app')
    answers.confirm.push(false, false)

    const { output } = await runInit([])

    expect(downloadTemplate).toHaveBeenCalledWith('minimal', expect.objectContaining({ dir: join(cwd, 'my-app') }))
    expect(runInstall).toHaveBeenCalledTimes(1)
    expect(output).toContain('Next steps')
    expect(output).toMatch(/cd \S*my-app/)
    expect(output).toContain('npm run dev')
  })

  it('should show the command that scaffolds the same project without prompts', async () => {
    answers.select.push('minimal', 'pnpm')
    answers.text.push('my-app')
    answers.confirm.push(false, false)

    const { output } = await runInit([])

    expect(output).toContain('without prompts')
    expect(output).toContain('--template=minimal')
    expect(output).toContain('--packageManager=pnpm')
  })

  it('should not offer the headless command when nothing was prompted for', async () => {
    const { output } = await runInit(['my-app', '--template=minimal', '--packageManager=npm', '--gitInit=false', '--no-modules'])

    expect(output).not.toContain('without prompts')
  })

  it('should stop when the user cancels the template prompt', async () => {
    answers.select.push(CANCELLED)

    const { exitCode } = await runInit([])

    expect(exitCode).toBe(1)
    expect(downloadTemplate).not.toHaveBeenCalled()
  })

  it('should stop when the user cancels the directory prompt', async () => {
    answers.select.push('minimal')
    answers.text.push(CANCELLED)

    const { exitCode } = await runInit([])

    expect(exitCode).toBe(1)
    expect(downloadTemplate).not.toHaveBeenCalled()
  })

  it('should initialise a git repository when asked to', async () => {
    await runInit(['my-app', '--template=minimal', '--packageManager=npm', '--gitInit', '--no-modules'])

    expect(tinyexec).toHaveBeenCalledWith('git', ['init'], expect.objectContaining({
      nodeOptions: expect.objectContaining({ cwd: join(cwd, 'my-app') }),
    }))
  })

  it('should report a git repository that could not be initialised', async () => {
    tinyexec.mockResolvedValue({ exitCode: 128, stdout: '', stderr: 'fatal: not a git repository' })

    const { output } = await runInit(['my-app', '--template=minimal', '--packageManager=npm', '--gitInit', '--no-modules'])

    expect(output).toContain('fatal: not a git repository')
  })
})

describe('template listing fallback', () => {
  it('should fall back to the bundled list when the starter repo is unreachable', async () => {
    getTemplates.mockRejectedValue(new Error('getaddrinfo ENOTFOUND raw.githubusercontent.com'))
    answers.select.push('minimal', 'npm')
    answers.text.push('my-app')
    answers.confirm.push(false, false)

    await runInit([])

    const { select } = await import('@clack/prompts')
    const options = vi.mocked(select).mock.calls[0]![0].options
    expect(options.length).toBeGreaterThan(0)
    expect(options.map(option => option.value)).toContain('minimal')
    expect(downloadTemplate).toHaveBeenCalledWith('minimal', expect.anything())
  })

  it('should not ask the network for templates when offline', async () => {
    answers.select.push('minimal', 'npm')
    answers.text.push('my-app')
    answers.confirm.push(false)

    await runInit(['--offline'])

    expect(getTemplates).not.toHaveBeenCalled()
    expect(downloadTemplate).toHaveBeenCalledWith('minimal', expect.objectContaining({ offline: true }))
  })

  it('should not browse modules when offline', async () => {
    answers.select.push('minimal', 'npm')
    answers.text.push('my-app')
    answers.confirm.push(false)

    await runInit(['--preferOffline'])

    expect(fetchModules).not.toHaveBeenCalled()
  })
})

describe('package manager selection', () => {
  it('should use the package manager the template pins', async () => {
    stubTemplate({ 'pnpm-lock.yaml': '' })

    const { output } = await runInit(['my-app', '--template=minimal', '--gitInit=false', '--no-modules'])

    expect(output).toContain('Using pnpm')
    expect(runInstall).toHaveBeenCalledWith(expect.objectContaining({
      packageManager: expect.objectContaining({ name: 'pnpm' }),
    }))
  })

  it('should skip the install when the requested package manager conflicts with the template', async () => {
    stubTemplate({ 'pnpm-lock.yaml': '' })

    const { output } = await runInit(['my-app', '--template=minimal', '--packageManager=npm', '--gitInit=false', '--no-modules'])

    expect(output).toContain('Skipping dependency installation')
    expect(runInstall).not.toHaveBeenCalled()
  })

  it('should opt a yarn project out of plug and play', async () => {
    const { output } = await runInit(['my-app', '--template=minimal', '--packageManager=yarn', '--gitInit=false', '--no-modules'])

    expect(await readFile(join(cwd, 'my-app', '.yarnrc.yml'), 'utf8')).toContain('nodeLinker: node-modules')
    expect(output).toContain('.yarnrc.yml')
  })

  it('should reject a package manager that does not exist', async () => {
    const { exitCode, output } = await runInit(['my-app', '--template=minimal', '--packageManager=nope'])

    expect(exitCode).toBe(2)
    expect(output).toContain('Invalid package manager')
    expect(downloadTemplate).not.toHaveBeenCalled()
  })
})

describe('recovery advice', () => {
  it('should tell the user to install by hand when the install fails', async () => {
    runInstall.mockResolvedValue({ success: false, error: 'npm ERR! network timeout', output: 'npm ERR! network timeout', command: 'npm install', ignoredBuilds: [] })

    const { output } = await runInit(['my-app', '--template=minimal', '--packageManager=npm', '--gitInit=false', '--no-modules'])

    expect(output).toContain('dependencies are not installed')
    expect(output).toContain('npm install')
    expect(process.exitCode).toBe(1)
  })

  it('should not add modules to a project whose install failed', async () => {
    runInstall.mockResolvedValue({ success: false, error: 'npm ERR! network timeout', output: 'npm ERR! network timeout', command: 'npm install', ignoredBuilds: [] })

    const { output } = await runInit(['my-app', '--template=minimal', '--packageManager=npm', '--gitInit=false', '--modules=@nuxt/image'])

    expect(output).toContain('Skipping module installation')
    expect(output).toContain('nuxt module add')
  })

  it('should offer `pnpm approve-builds` when builds were ignored', async () => {
    stubTemplate({ 'pnpm-lock.yaml': '' })
    runInstall.mockResolvedValue({ success: true, output: '', command: 'pnpm install', ignoredBuilds: ['better-sqlite3'] })
    answers.confirm.push(false)

    const { output } = await runInit(['my-app', '--template=minimal', '--gitInit=false', '--no-modules'])

    expect(output).toContain('did not run build scripts')
    expect(output).toContain('pnpm approve-builds')
  })

  it('should tell the user to install when the install was skipped', async () => {
    const { output } = await runInit(['my-app', '--template=minimal', '--packageManager=npm', '--gitInit=false', '--install=false', '--no-modules'])

    expect(runInstall).not.toHaveBeenCalled()
    expect(output).toContain('npm install')
  })
})
