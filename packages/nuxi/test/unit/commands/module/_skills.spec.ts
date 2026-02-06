import process from 'node:process'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { installModuleSkills } from '../../../../src/commands/module/_skills'
import { logger } from '../../../../src/utils/logger'

const {
  detectInstalledAgents,
  formatDetectedAgentIds,
  installSkill,
  spinnerStart,
  spinnerStop,
  log,
} = vi.hoisted(() => {
  return {
    detectInstalledAgents: vi.fn(() => [{ id: 'codex', config: { name: 'OpenAI Codex CLI', skillsDir: 'skills' } }]),
    formatDetectedAgentIds: vi.fn(() => 'OpenAI Codex CLI (codex)'),
    installSkill: vi.fn(async () => ({ installed: [{ skill: 'foo', agent: 'codex', path: '/tmp/foo' }], errors: [] })),
    spinnerStart: vi.fn(),
    spinnerStop: vi.fn(),
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
    log,
    spinner: () => ({
      start: spinnerStart,
      stop: spinnerStop,
    }),
  }
})

vi.mock('unagent', async () => {
  return {
    detectInstalledAgents,
    formatDetectedAgentIds,
    installSkill,
  }
})

describe('installModuleSkills', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    detectInstalledAgents.mockReturnValue([{ id: 'codex', config: { name: 'OpenAI Codex CLI', skillsDir: 'skills' } }])
    installSkill.mockResolvedValue({ installed: [{ skill: 'foo', agent: 'codex', path: '/tmp/foo' }], errors: [] })
  })

  it('sanitizes unknown agent ids', async () => {
    await expect(installModuleSkills([{
      source: '/tmp/source',
      label: 'some-module',
      moduleName: 'some-module',
      isLocal: true,
      mode: 'symlink',
    } as any], { agents: ['codex', 'unknown'] })).resolves.toBeUndefined()

    expect(installSkill).toHaveBeenCalledTimes(1)
    expect(installSkill).toHaveBeenCalledWith(expect.objectContaining({
      agents: ['codex'],
    }))
  })

  it('does not install when no matching agent ids are provided', async () => {
    const warnSpy = vi.spyOn(logger, 'warn')
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)

    await expect(installModuleSkills([{
      source: '/tmp/source',
      label: 'some-module',
      moduleName: 'some-module',
      isLocal: false,
      mode: 'copy',
    } as any], { agents: ['unknown'] })).resolves.toBeUndefined()

    expect(installSkill).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith('No matching AI coding agents detected')
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('passes agents as undefined when no filtering is requested', async () => {
    await expect(installModuleSkills([{
      source: '/tmp/source',
      label: 'some-module',
      moduleName: 'some-module',
      isLocal: false,
      mode: 'copy',
    } as any])).resolves.toBeUndefined()

    expect(installSkill).toHaveBeenCalledTimes(1)
    expect(installSkill).toHaveBeenCalledWith(expect.objectContaining({
      agents: undefined,
    }))
  })
})
