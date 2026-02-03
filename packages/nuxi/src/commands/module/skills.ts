import type { BundledSkillSource, InstalledSkill, UninstallSkillResult } from 'unagent'
import type { ModuleSkillSource } from './_skills'
import process from 'node:process'
import { confirm, isCancel, spinner } from '@clack/prompts'
import { defineCommand } from 'citty'
import { colors } from 'consola/utils'
import { resolve } from 'pathe'
import { readPackageJSON } from 'pkg-types'
import { formatSkillNames, getAgentDisplayNames, getBundledSkillSources, listInstalledSkills, uninstallSkill } from 'unagent'

import { logger } from '../../utils/logger'
import { cwdArgs, logLevelArgs } from '../_shared'
import { detectModuleSkills, installModuleSkills } from './_skills'
import { fetchModules } from './_utils'

export default defineCommand({
  meta: {
    name: 'skills',
    description: 'Manage agent skills from installed modules',
  },
  args: {
    ...cwdArgs,
    ...logLevelArgs,
    install: { type: 'boolean', alias: 'i', description: 'Install skills without prompting' },
    list: { type: 'boolean', alias: 'l', description: 'List installed skills' },
    remove: { type: 'string', alias: 'r', description: 'Remove a skill by name' },
  },
  async setup(ctx) {
    const cwd = resolve(ctx.args.cwd)

    // Show detected agents
    const agents = getAgentDisplayNames()
    if (agents.length === 0) {
      logger.warn('No AI coding agents detected')
      return
    }
    logger.info(`Detected agents: ${colors.cyan(agents.join(', '))}`)

    // --list: Show installed skills
    if (ctx.args.list) {
      let installed: InstalledSkill[] = []
      try {
        installed = listInstalledSkills()
      }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const isMissingSkillPath = message.includes('ENOENT') || message.includes('no such file or directory')
        if (isMissingSkillPath) {
          logger.warn(`Skipping invalid skill entry: ${message}`)
          return
        }
        logger.error(`Failed to list installed skills: ${message}`)
        process.exit(1)
      }

      if (installed.length === 0) {
        logger.info('No skills installed')
        return
      }

      const byAgent = new Map<string, InstalledSkill[]>()
      for (const skill of installed) {
        const list = byAgent.get(skill.agent) || []
        list.push(skill)
        byAgent.set(skill.agent, list)
      }

      for (const [agent, skills] of byAgent) {
        logger.info(`\n${colors.bold(agent)}:`)
        for (const skill of skills)
          logger.info(`  ${colors.cyan(skill.name)} ${colors.dim(skill.path)}`)
      }
      return
    }

    // --remove: Remove a skill
    if (ctx.args.remove) {
      const skillName = ctx.args.remove
      logger.info(`Removing skill: ${colors.cyan(skillName)}`)
      let result: UninstallSkillResult
      try {
        result = await uninstallSkill({ skill: skillName })
      }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error(`Failed to remove skill: ${skillName} (${message})`)
        process.exit(1)
      }

      if (result.success && result.removed.length > 0) {
        const removedAgents = result.removed.map((r: { agent: string }) => r.agent).join(', ')
        logger.success(`Removed ${skillName} from ${removedAgents}`)
      }
      else {
        for (const err of result.errors)
          logger.warn(`${err.agent}: ${err.error}`)
        logger.error(`Failed to remove skill: ${skillName}`)
        process.exit(1)
      }
      return
    }

    // Default: Scan and install skills
    const pkg = await readPackageJSON(cwd).catch(() => null)
    if (!pkg) {
      logger.error('No package.json found')
      process.exit(1)
    }

    const checkSpinner = spinner()
    checkSpinner.start('Scanning for agent skills...')

    // 1. Scan node_modules for bundled skills
    let bundledSkills: ModuleSkillSource[] = []
    try {
      const bundledSources: BundledSkillSource[] = getBundledSkillSources(cwd)
      bundledSkills = bundledSources.map((s: BundledSkillSource) => ({
        source: s.source,
        skills: s.skills,
        label: s.packageName,
        moduleName: s.packageName,
        isLocal: true,
        mode: 'symlink' as const,
      }))
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn(`Failed to scan bundled skills: ${message}`)
    }

    // 2. Check module meta for remote skills
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
    const depNames = Object.keys(allDeps)
    const knownModules = await fetchModules().catch(() => [])
    const knownModuleNames = new Set(knownModules.map(m => m.npm))
    const moduleNames = depNames.filter(name =>
      knownModuleNames.has(name) || name.startsWith('@nuxt/') || name.startsWith('nuxt-'),
    )
    let metaSkills: ModuleSkillSource[] = []
    try {
      metaSkills = await detectModuleSkills(moduleNames, cwd)
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn(`Failed to scan module meta skills: ${message}`)
    }

    // Combine results, preferring bundled (local) over remote
    const bundledModules = new Set(bundledSkills.map(s => s.moduleName))
    const remoteOnly = metaSkills.filter(s => !bundledModules.has(s.moduleName))
    const allSkills = [...bundledSkills, ...remoteOnly]

    checkSpinner.stop(allSkills.length > 0
      ? `Found skills in ${allSkills.length} package(s)`
      : 'Skills scan complete')

    if (allSkills.length === 0)
      return

    // Show what was found
    for (const info of allSkills) {
      const skills = info.skills?.length ? info.skills.join(', ') : 'all'
      const source = info.isLocal ? colors.dim('(bundled)') : colors.dim('(remote)')
      logger.info(`  ${colors.cyan(info.moduleName)}: ${skills} ${source}`)
    }

    const shouldInstall = ctx.args.install || await confirm({
      message: `Install agent skill(s): ${formatSkillNames(allSkills)}?`,
      initialValue: true,
    })

    if (isCancel(shouldInstall) || !shouldInstall)
      return

    await installModuleSkills(allSkills)
  },
})
