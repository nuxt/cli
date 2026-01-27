import { spinner } from '@clack/prompts'
import { join } from 'pathe'
import { x } from 'tinyexec'

// Types from @nuxt/schema (PR 1) - defined locally until schema is updated
interface ModuleAgentSkillsConfig {
  url: string
  skills?: string[]
}

interface ModuleAgentsConfig {
  skills?: ModuleAgentSkillsConfig
}

interface ModuleMeta {
  name?: string
  agents?: ModuleAgentsConfig
}

export interface ModuleSkillInfo {
  url: string
  skills?: string[]
  moduleName: string
}

export async function detectModuleSkills(moduleNames: string[], cwd: string): Promise<ModuleSkillInfo[]> {
  const result: ModuleSkillInfo[] = []

  for (const pkgName of moduleNames) {
    const meta = await getModuleMeta(pkgName, cwd)
    if (meta?.agents?.skills?.url) {
      result.push({
        url: meta.agents.skills.url,
        skills: meta.agents.skills.skills,
        moduleName: pkgName,
      })
    }
  }
  return result
}

async function getModuleMeta(pkgName: string, cwd: string): Promise<ModuleMeta | null> {
  try {
    const modulePath = join(cwd, 'node_modules', pkgName)
    const mod = await import(modulePath)
    return await mod?.default?.getMeta?.()
  }
  catch {
    return null
  }
}

export async function installSkills(infos: ModuleSkillInfo[], cwd: string): Promise<void> {
  for (const info of infos) {
    const skills = info.skills ?? []
    const label = skills.length > 0 ? `Installing ${skills.join(', ')}...` : `Installing skills from ${info.url}...`

    const s = spinner()
    s.start(label)

    try {
      const args = ['skills', 'add', info.url, '-y']
      if (skills.length > 0) {
        args.push('--skill', ...skills)
      }

      await x('npx', args, {
        nodeOptions: { cwd, stdio: 'pipe' },
      })

      s.stop('Installed to detected agents')
    }
    catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      s.stop('Failed to install skills')
      console.warn(`Skill installation failed: ${msg}`)
    }
  }
}

export function getSkillNames(infos: ModuleSkillInfo[]): string {
  return infos
    .flatMap(i => i.skills?.length ? i.skills : ['all'])
    .join(', ')
}
