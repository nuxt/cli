import type { BundledSkillSource, InstalledSkill, UninstallSkillResult } from 'unagent'
import type { ModuleSkillSource } from './_skills'
import process from 'node:process'
import { groupMultiselect, isCancel, note, select, spinner } from '@clack/prompts'
import { defineCommand } from 'citty'
import { colors } from 'consola/utils'
import { resolve } from 'pathe'
import { readPackageJSON } from 'pkg-types'
import type { DetectedAgent } from 'unagent'
import { detectInstalledAgents, formatSkillNames, getAgentDisplayNames, getBundledSkillSources, listInstalledSkills, uninstallSkill } from 'unagent'

import { logger } from '../../utils/logger'
import { cwdArgs, logLevelArgs } from '../_shared'
import { detectModuleSkills, installModuleSkills } from './_skills'
import { fetchModules } from './_utils'

type InstallMode = 'auto' | 'copy' | 'symlink'
const SKILL_VALUE_SEPARATOR = '::'
const SKILL_ALL_TOKEN = '*'

function formatAgentList(agents: DetectedAgent[]): string {
  if (agents.length === 0)
    return 'none'
  return getAgentDisplayNames(agents).join(', ')
}

function formatSkillPlan(agents: DetectedAgent[], sources: ModuleSkillSource[]): string {
  const lines = [
    `Agents: ${formatAgentList(agents)}`,
    'Mode: auto (symlink local, copy remote)',
    'Skills:',
    ...sources.map((source) => {
      const skills = source.skills?.length ? source.skills.join(', ') : 'all'
      return `- ${source.moduleName}: ${skills}`
    }),
  ]
  return lines.join('\n')
}

function buildSkillGroups(sources: ModuleSkillSource[]) {
  const groups: Record<string, Array<{ label: string, value: string, hint?: string }>> = {}
  const initialValues: string[] = []

  for (const source of sources) {
    const skills = source.skills?.length ? source.skills : null
    const options = skills
      ? skills.map(skill => ({ label: skill, value: `${source.moduleName}${SKILL_VALUE_SEPARATOR}${skill}` }))
      : [{ label: 'all', value: `${source.moduleName}${SKILL_VALUE_SEPARATOR}${SKILL_ALL_TOKEN}`, hint: 'includes all skills' }]
    groups[source.moduleName] = options
    initialValues.push(...options.map(option => option.value))
  }

  return { groups, initialValues }
}

function applySkillSelection(sources: ModuleSkillSource[], selectedValues: string[]) {
  const selectedByModule = new Map<string, { all: boolean, skills: Set<string> }>()

  for (const value of selectedValues) {
    const [moduleName, skillName] = value.split(SKILL_VALUE_SEPARATOR)
    const entry = selectedByModule.get(moduleName) || { all: false, skills: new Set<string>() }
    if (skillName === SKILL_ALL_TOKEN)
      entry.all = true
    else if (skillName)
      entry.skills.add(skillName)
    selectedByModule.set(moduleName, entry)
  }

  const selectedSources: ModuleSkillSource[] = []
  for (const source of sources) {
    const selected = selectedByModule.get(source.moduleName)
    if (!selected)
      continue
    if (selected.all) {
      selectedSources.push({ ...source, skills: undefined })
      continue
    }
    const sourceSkills = source.skills?.length ? source.skills : []
    const filtered = sourceSkills.filter(skill => selected.skills.has(skill))
    if (filtered.length === 0)
      continue
    selectedSources.push({ ...source, skills: filtered })
  }

  return selectedSources
}

function applyInstallMode(sources: ModuleSkillSource[], mode: InstallMode) {
  if (mode === 'auto')
    return { sources, forcedCopy: false }

  let forcedCopy = false
  const next = sources.map((source) => {
    if (mode === 'symlink' && !source.isLocal) {
      forcedCopy = true
      return { ...source, mode: 'copy' as const }
    }
    return { ...source, mode }
  })

  return { sources: next, forcedCopy }
}

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
    const detectedAgents = detectInstalledAgents()
    const agents = getAgentDisplayNames(detectedAgents)
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
        logger.info(`${colors.bold(agent)}:`)
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

    let selectedSources = allSkills
    let selectedAgents: string[] | undefined
    let selectedMode: InstallMode = 'auto'

    if (!ctx.args.install) {
      note(formatSkillPlan(detectedAgents, allSkills), 'Planned install')

      const action = await select({
        message: `Install agent skill(s): ${formatSkillNames(allSkills)}?`,
        options: [
          { value: 'yes', label: 'Yes', hint: 'Install with planned settings' },
          { value: 'config', label: 'Change configuration', hint: 'Choose agent, mode, and skills' },
          { value: 'no', label: 'No', hint: 'Skip installing skills' },
        ],
        initialValue: 'yes',
      })

      if (isCancel(action) || action === 'no')
        return

      if (action === 'config') {
        const agentChoice = await select({
          message: 'Which AI agent should receive the skills?',
          options: [
            { value: '__all__', label: 'All detected agents', hint: 'default' },
            ...detectedAgents.map(agent => ({
              value: agent.id,
              label: `${agent.config.name} (${agent.id})`,
            })),
          ],
          initialValue: '__all__',
        })

        if (isCancel(agentChoice))
          return

        if (agentChoice !== '__all__')
          selectedAgents = [agentChoice]

        const modeChoice = await select({
          message: 'Install mode:',
          options: [
            { value: 'auto', label: 'Auto', hint: 'symlink local, copy remote' },
            { value: 'copy', label: 'Copy', hint: 'copy into agent skill dir' },
            { value: 'symlink', label: 'Symlink', hint: 'link to source (local only)' },
          ],
          initialValue: 'auto',
        })

        if (isCancel(modeChoice))
          return

        selectedMode = modeChoice as InstallMode

        const { groups, initialValues } = buildSkillGroups(allSkills)
        const skillSelection = await groupMultiselect({
          message: 'Select skills to install:',
          options: groups,
          initialValues,
          required: false,
        })

        if (isCancel(skillSelection))
          return

        selectedSources = applySkillSelection(allSkills, skillSelection as string[])
        if (selectedSources.length === 0) {
          logger.info('No skills selected')
          return
        }
      }
    }

    const modeResult = applyInstallMode(selectedSources, selectedMode)
    selectedSources = modeResult.sources
    if (modeResult.forcedCopy)
      logger.warn('Symlink mode applies only to local skills; remote skills will be copied.')

    await installModuleSkills(selectedSources, { agents: selectedAgents })
  },
})
