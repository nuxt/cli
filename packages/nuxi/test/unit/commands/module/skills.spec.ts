import type { UninstallSkillResult } from 'unagent'
import process from 'node:process'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import skillsCommand from '../../../../src/commands/module/skills'
import { logger } from '../../../../src/utils/logger'

const {
  select,
  groupMultiselect,
  note,
  detectModuleSkills,
  detectInstalledAgents,
  fetchModules,
  formatSkillNames,
  getAgentDisplayNames,
  getBundledSkillSources,
  installModuleSkills,
  isCancel,
  listInstalledSkills,
  readPackageJSON,
  spinnerStart,
  spinnerStop,
  uninstallSkill,
  log,
} = vi.hoisted(() => {
  return {
    select: vi.fn(async () => 'yes'),
    groupMultiselect: vi.fn(async () => []),
    note: vi.fn(),
    detectModuleSkills: vi.fn(async () => []),
    detectInstalledAgents: vi.fn(() => [{ id: 'codex', config: { name: 'OpenAI Codex CLI', skillsDir: 'skills' } }]),
    fetchModules: vi.fn(async () => []),
    formatSkillNames: vi.fn(() => 'all'),
    getAgentDisplayNames: vi.fn(() => ['OpenAI Codex CLI (codex)']),
    getBundledSkillSources: vi.fn(() => []),
    installModuleSkills: vi.fn(async () => undefined),
    isCancel: vi.fn(() => false),
    listInstalledSkills: vi.fn(() => []),
    readPackageJSON: vi.fn(async () => ({ dependencies: { nuxt: '^3.0.0' } })),
    spinnerStart: vi.fn(),
    spinnerStop: vi.fn(),
    uninstallSkill: vi.fn(async () => ({ success: true, removed: [{ skill: 'foo', agent: 'codex', path: '/tmp/foo' }], errors: [] })),
    log: {
      error: vi.fn(),
      info: vi.fn(),
      message: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
    },
  }
})

vi.mock('@clack/prompts', async () => {
  return {
    groupMultiselect,
    isCancel,
    log,
    note,
    select,
    spinner: () => ({
      start: spinnerStart,
      stop: spinnerStop,
    }),
  }
})

vi.mock('pkg-types', async () => {
  return {
    readPackageJSON,
  }
})

vi.mock('unagent', async () => {
  return {
    detectInstalledAgents,
    formatSkillNames,
    getAgentDisplayNames,
    getBundledSkillSources,
    listInstalledSkills,
    uninstallSkill,
  }
})

vi.mock('../../../../src/commands/module/_skills', async () => {
  return {
    detectModuleSkills,
    installModuleSkills,
  }
})

vi.mock('../../../../src/commands/module/_utils', async () => {
  return {
    fetchModules,
  }
})

function runSkillsCommand(args: Record<string, unknown>) {
  return (skillsCommand as { setup: (ctx: { args: Record<string, unknown> }) => Promise<void> }).setup({ args })
}

describe('module skills', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getAgentDisplayNames.mockReturnValue(['OpenAI Codex CLI (codex)'])
    listInstalledSkills.mockReturnValue([])
    getBundledSkillSources.mockReturnValue([])
    fetchModules.mockResolvedValue([])
    detectModuleSkills.mockResolvedValue([])
    readPackageJSON.mockResolvedValue({ dependencies: { nuxt: '^3.0.0' } })
    uninstallSkill.mockResolvedValue({
      success: true,
      removed: [{ skill: 'foo', agent: 'codex', path: '/tmp/foo' }],
      errors: [],
    } satisfies UninstallSkillResult)
    installModuleSkills.mockResolvedValue(undefined)
  })

  it('skips invalid skill entries on --list', async () => {
    listInstalledSkills.mockImplementationOnce(() => {
      throw new Error('ENOENT: no such file or directory')
    })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code: number) => {
      throw new Error(`process.exit:${code}`)
    }) as never)
    const warnSpy = vi.spyOn(logger, 'warn')

    await expect(runSkillsCommand({
      cwd: '/fake-dir',
      _: [],
      list: true,
    })).resolves.toBeUndefined()

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Skipping invalid skill entry'))
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('continues default scan when bundled/meta scanners fail', async () => {
    const warnSpy = vi.spyOn(logger, 'warn')
    getBundledSkillSources.mockImplementationOnce(() => {
      throw new Error('bundled scan failed')
    })
    detectModuleSkills.mockRejectedValueOnce(new Error('meta scan failed'))

    await expect(runSkillsCommand({
      cwd: '/fake-dir',
      _: [],
      install: true,
    })).resolves.toBeUndefined()

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to scan bundled skills'))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to scan module meta skills'))
    expect(installModuleSkills).not.toHaveBeenCalled()
  })

  it('handles --remove failures with clean exit', async () => {
    uninstallSkill.mockResolvedValueOnce({
      success: false,
      removed: [],
      errors: [{ skill: 'missing-skill', agent: 'codex', error: 'Skill not installed' }],
    } as any)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code: number) => {
      throw new Error(`process.exit:${code}`)
    }) as never)
    const warnSpy = vi.spyOn(logger, 'warn')
    const errorSpy = vi.spyOn(logger, 'error')

    await expect(runSkillsCommand({
      cwd: '/fake-dir',
      _: [],
      remove: 'missing-skill',
    })).rejects.toThrow('process.exit:1')

    expect(warnSpy).toHaveBeenCalledWith('codex: Skill not installed')
    expect(errorSpy).toHaveBeenCalledWith('Failed to remove skill: missing-skill')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})
