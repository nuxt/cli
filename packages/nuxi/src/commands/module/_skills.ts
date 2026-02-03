import type { BatchInstallCallbacks, InstallSkillResult, SkillSource } from 'unagent'
import { createRequire } from 'node:module'
import { spinner } from '@clack/prompts'
import { detectInstalledAgents, formatDetectedAgentIds, installSkillBatch } from 'unagent'

import { logger } from '../../utils/logger'

// TODO: Import from @nuxt/schema when nuxt/nuxt#34187 is merged
interface ModuleAgentSkillsConfig { url: string, skills?: string[] }
interface ModuleAgentsConfig { skills?: ModuleAgentSkillsConfig }
interface ModuleMeta { name?: string, agents?: ModuleAgentsConfig }

export interface ModuleSkillSource extends SkillSource {
  moduleName: string
  isLocal: boolean
}

/**
 * Detect skills from module meta (meta.agents.skills.url)
 */
export async function detectModuleSkills(moduleNames: string[], cwd: string): Promise<ModuleSkillSource[]> {
  const result: ModuleSkillSource[] = []

  for (const pkgName of moduleNames) {
    const meta = await getModuleMeta(pkgName, cwd)
    if (meta?.agents?.skills?.url) {
      result.push({
        source: meta.agents.skills.url,
        skills: meta.agents.skills.skills,
        label: pkgName,
        moduleName: pkgName,
        isLocal: false,
        mode: 'copy',
      })
    }
  }
  return result
}

async function getModuleMeta(pkgName: string, cwd: string): Promise<ModuleMeta | null> {
  try {
    const require = createRequire(`${cwd}/`)
    const modulePath = require.resolve(pkgName)
    const mod = await import(modulePath)
    const meta: unknown = await mod?.default?.getMeta?.()
    if (meta && typeof meta === 'object')
      return meta as ModuleMeta
    return null
  }
  catch {
    return null
  }
}

export async function installModuleSkills(sources: ModuleSkillSource[]): Promise<void> {
  const installedAgents = detectInstalledAgents()
  if (installedAgents.length === 0) {
    logger.warn('No AI coding agents detected')
    return
  }

  const agentNames = formatDetectedAgentIds()

  const callbacks: BatchInstallCallbacks = {
    onStart: (source: SkillSource) => {
      const info = source as ModuleSkillSource
      const skills = info.skills ?? []
      const label = skills.length > 0
        ? `Installing ${skills.join(', ')} from ${info.moduleName}...`
        : `Installing skills from ${info.moduleName}...`
      const s = spinner()
      s.start(label)
      ;(source as ModuleSkillSource & { _spinner: typeof s })._spinner = s
    },
    onSuccess: (source: SkillSource, result: InstallSkillResult) => {
      const info = source as ModuleSkillSource & { _spinner: ReturnType<typeof spinner> }
      if (result.installed.length > 0) {
        const skillNames = [...new Set(result.installed.map((i: { skill: string }) => i.skill))].join(', ')
        const mode = info.isLocal ? 'linked' : 'installed'
        info._spinner?.stop(`${mode} ${skillNames} → ${agentNames}`)
      }
      else {
        info._spinner?.stop('No skills found')
      }
    },
    onError: (source: SkillSource, error: string) => {
      const info = source as ModuleSkillSource & { _spinner: ReturnType<typeof spinner> }
      info._spinner?.stop('Failed to install skills')
      logger.warn(`Skill installation failed for ${info.moduleName}: ${error}`)
    },
  }

  try {
    await installSkillBatch(sources, callbacks)
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn(`Failed to install agent skills: ${message}`)
  }
}
