import type { DownloadTemplateResult } from 'giget'
import type { PackageManagerName } from 'nypm'
import type { TemplateData } from '../utils/starter-templates'

import { existsSync } from 'node:fs'
import process from 'node:process'

import { box, cancel, confirm, intro, isCancel, note, outro, select, spinner, tasks, text } from '@clack/prompts'
import { defineCommand } from 'citty'
import { colors } from 'consola/utils'
import { downloadTemplate, startShell } from 'giget'
import { installDependencies } from 'nypm'
import { $fetch } from 'ofetch'
import { basename, join, relative, resolve } from 'pathe'
import { findFile, readPackageJSON, writePackageJSON } from 'pkg-types'
import { agent, hasTTY, isAgent, isCI } from 'std-env'
import { x } from 'tinyexec'

import { runCommand } from '../run'
import { nuxtIcon, themeColor } from '../utils/ascii'
import { logger } from '../utils/logger'
import { relativeToProcess } from '../utils/paths'
import { getTemplates } from '../utils/starter-templates'
import { getNuxtVersion } from '../utils/versions'
import { cwdArgs, logLevelArgs } from './_shared'
import { selectModulesAutocomplete } from './module/_autocomplete'
import { checkNuxtCompatibility, fetchModules } from './module/_utils'
import addModuleCommand from './module/add'

const NON_WORD_RE = /[^\w-]/g
const MULTI_DASH_RE = /-{2,}/g
const LEADING_TRAILING_DASH_RE = /^-|-$/g

const DEFAULT_REGISTRY = 'https://raw.githubusercontent.com/nuxt/starter/templates/templates'
const DEFAULT_TEMPLATE_NAME = 'minimal'

const pms: Record<PackageManagerName, undefined> = {
  npm: undefined,
  pnpm: undefined,
  yarn: undefined,
  bun: undefined,
  deno: undefined,
}

// this is for type safety to prompt updating code in nuxi when nypm adds a new package manager
const packageManagerOptions = Object.keys(pms) as PackageManagerName[]

export default defineCommand({
  meta: {
    name: 'init',
    description: 'Initialize a fresh project',
  },
  args: {
    ...cwdArgs,
    ...logLevelArgs,
    dir: {
      type: 'positional',
      description: 'Project directory',
      default: '',
    },
    template: {
      type: 'string',
      alias: 't',
      description: 'Template name',
    },
    force: {
      type: 'boolean',
      alias: 'f',
      description: 'Override existing directory',
    },
    offline: {
      type: 'boolean',
      description: 'Force offline mode',
    },
    preferOffline: {
      type: 'boolean',
      description: 'Prefer offline mode',
    },
    install: {
      type: 'boolean',
      default: true,
      description: 'Skip installing dependencies',
    },
    gitInit: {
      type: 'boolean',
      description: 'Initialize git repository',
    },
    shell: {
      type: 'boolean',
      description: 'Start shell after installation in project directory',
    },
    packageManager: {
      type: 'string',
      description: 'Package manager choice (npm, pnpm, yarn, bun)',
    },
    modules: {
      type: 'string',
      required: false,
      description: 'Nuxt modules to install (comma separated without spaces)',
      negativeDescription: 'Skip module installation prompt',
      alias: 'M',
    },
    nightly: {
      type: 'string',
      description: 'Use Nuxt nightly release channel (3x or latest)',
    },
    defaults: {
      type: 'boolean',
      alias: 'y',
      description: 'Use defaults for all prompts (useful for CI/agent environments)',
    },
    interactive: {
      type: 'boolean',
      default: true,
      negativeDescription: 'Disable interactive prompts and use defaults',
    },
  },
  async run(ctx) {
    if (!ctx.args.offline && !ctx.args.preferOffline && !ctx.args.template) {
      getTemplates().catch(() => null)
    }

    if (hasTTY) {
      process.stdout.write(`\n${nuxtIcon}\n\n`)
    }

    intro(colors.bold(`Welcome to Nuxt!`.split('').map(m => `${themeColor}${m}`).join('')))

    // Detect non-interactive environments: agent, CI, no TTY, or explicit flags
    const isNonInteractive
      = ctx.args.defaults === true
        || ctx.args.interactive === false
        || isAgent // AI coding agent (Claude, Cursor, Copilot, Devin, Gemini…)
        || isCI // CI/CD pipeline
        || !hasTTY // no terminal attached (piped, subprocess, etc.)

    if (isNonInteractive) {
      const reason = ctx.args.defaults || ctx.args.interactive === false
        ? 'flag'
        : isAgent
          ? `agent (${agent})`
          : isCI
            ? 'CI environment'
            : 'no TTY'
      logger.info(`Running in non-interactive mode (${reason}). Prompts will use defaults.`)
    }

    // Detect current package manager early so it can be shown in the options note
    const currentPackageManager = detectCurrentPackageManager()

    let availableTemplates: Record<string, TemplateData> = {}

    if (!ctx.args.template || !ctx.args.dir) {
      const defaultTemplates = await import('../data/templates').then(r => r.templates)
      if (ctx.args.offline || ctx.args.preferOffline) {
        // In offline mode, use static templates directly
        availableTemplates = defaultTemplates
      }
      else {
        const templatesSpinner = spinner()
        templatesSpinner.start('Loading available templates')

        try {
          availableTemplates = await getTemplates()
          templatesSpinner.stop('Templates loaded')
        }
        catch {
          availableTemplates = defaultTemplates
          templatesSpinner.stop('Templates loaded from cache')
        }
      }
    }

    // In non-interactive mode, print all available options and the exact values
    // that will be used this run, so agents can discover flags and re-run with
    // custom settings.
    if (isNonInteractive) {
      // Compute every effective value upfront so the agent sees the full picture
      // before any action is taken.
      const effectiveTemplate = ctx.args.template || DEFAULT_TEMPLATE_NAME
      const effectiveDir = ctx.args.dir || availableTemplates[effectiveTemplate]?.defaultDir || 'nuxt-app'
      const effectivePM: PackageManagerName
        = (packageManagerOptions.includes(ctx.args.packageManager as PackageManagerName)
          ? ctx.args.packageManager as PackageManagerName
          : undefined)
        ?? currentPackageManager
        ?? 'npm'
      const effectiveGitInit = (ctx.args.gitInit as unknown) === 'false' ? false : (ctx.args.gitInit ?? false)
      const effectiveInstall = ctx.args.install !== false && (ctx.args.install as unknown) !== 'false'
      const effectiveModules = ctx.args.modules === undefined
        ? '(none)'
        : !ctx.args.modules
            ? '(skipped)'
            : ctx.args.modules as string

      const templateLines = Object.entries(availableTemplates).map(([name, data]) =>
        `  ${colors.cyan(name.padEnd(18))} ${data?.description ?? ''}${name === DEFAULT_TEMPLATE_NAME ? colors.dim('  ← default') : ''}`,
      )

      note(
        [
          colors.bold('Re-run with any of these flags to customise:'),
          '',
          `${colors.cyan('--template')} <name>`,
          ...templateLines,
          '',
          `${colors.cyan('<dir>')}                        Project directory`,
          `${colors.cyan('--packageManager')} <pm>        npm | pnpm | yarn | bun | deno`,
          `${colors.cyan('--gitInit')} / ${colors.cyan('--no-gitInit')}            Initialise git repo`,
          `${colors.cyan('--install')} / ${colors.cyan('--no-install')}            Install dependencies`,
          `${colors.cyan('--modules')} <m1,m2,...>        e.g. ${colors.dim('@nuxt/content,@nuxt/ui,@nuxt/image')}`,
          `${colors.dim('                             Full list: https://nuxt.com/modules')}`,
          `${colors.cyan('--no-modules')}                Skip module prompt`,
          `${colors.cyan('--force')}                     Override existing directory`,
          `${colors.cyan('--offline')}                   Use cached templates`,
          '',
          colors.bold('Proceeding with:'),
          `  template:       ${colors.cyan(effectiveTemplate)}`,
          `  directory:      ${colors.cyan(effectiveDir)}`,
          `  packageManager: ${colors.cyan(effectivePM)}`,
          `  gitInit:        ${colors.cyan(String(effectiveGitInit))}`,
          `  install:        ${colors.cyan(String(effectiveInstall))}`,
          `  modules:        ${colors.cyan(effectiveModules)}`,
        ].join('\n'),
        'Available options',
      )

      // No project directory was given — the agent now has all the information
      // it needs to re-run with explicit flags. Exit without creating anything.
      if (!ctx.args.dir) {
        outro('Re-run with a project directory to proceed, e.g: nuxi init <dir>')
        process.exit(0)
      }
    }

    let templateName = ctx.args.template
    if (!templateName) {
      if (isNonInteractive) {
        templateName = DEFAULT_TEMPLATE_NAME
      }
      else {
        const result = await select({
          message: 'Which template would you like to use?',
          options: Object.entries(availableTemplates).map(([name, data]) => {
            return {
              value: name,
              label: data ? `${colors.whiteBright(name)} – ${data.description}` : name,
              hint: name === DEFAULT_TEMPLATE_NAME ? 'recommended' : undefined,
            }
          }),
          initialValue: DEFAULT_TEMPLATE_NAME,
        })

        if (isCancel(result)) {
          cancel('Operation cancelled.')
          process.exit(1)
        }

        templateName = result
      }
    }

    // Fallback to default if still not set
    templateName ||= DEFAULT_TEMPLATE_NAME

    if (typeof templateName !== 'string') {
      logger.error('Please specify a template!')
      process.exit(1)
    }

    let dir = ctx.args.dir
    if (dir === '') {
      const defaultDir = availableTemplates[templateName]?.defaultDir || 'nuxt-app'
      const result = await text({
        message: 'Where would you like to create your project?',
        placeholder: `./${defaultDir}`,
        defaultValue: defaultDir,
      })

      if (isCancel(result)) {
        cancel('Operation cancelled.')
        process.exit(1)
      }

      dir = result
    }

    const cwd = resolve(ctx.args.cwd)
    let templateDownloadPath = resolve(cwd, dir)
    logger.step(`Creating project in ${colors.cyan(relativeToProcess(templateDownloadPath))}`)

    let shouldForce = Boolean(ctx.args.force)

    // Prompt the user if the template download directory already exists
    // when no `--force` flag is provided
    const shouldVerify = !shouldForce && existsSync(templateDownloadPath)
    if (shouldVerify) {
      if (isNonInteractive) {
        logger.error(
          `Directory ${colors.cyan(relativeToProcess(templateDownloadPath))} already exists. `
          + `Pass ${colors.cyan('--force')} to override or specify a different directory.`,
        )
        process.exit(1)
      }

      const selectedAction = await select({
        message: `The directory ${colors.cyan(relativeToProcess(templateDownloadPath))} already exists. What would you like to do?`,
        options: [
          { value: 'override', label: 'Override its contents' },
          { value: 'different', label: 'Select different directory' },
          { value: 'abort', label: 'Abort' },
        ],
      })

      if (isCancel(selectedAction)) {
        cancel('Operation cancelled.')
        process.exit(1)
      }

      switch (selectedAction) {
        case 'override':
          shouldForce = true
          break

        case 'different': {
          const result = await text({
            message: 'Please specify a different directory:',
          })

          if (isCancel(result)) {
            cancel('Operation cancelled.')
            process.exit(1)
          }

          templateDownloadPath = resolve(cwd, result)
          break
        }

        // 'Abort'
        case 'abort':
        default:
          process.exit(1)
      }
    }

    // Download template
    let template: DownloadTemplateResult

    const downloadSpinner = spinner()
    downloadSpinner.start(`Downloading ${colors.cyan(templateName)} template`)

    try {
      template = await downloadTemplate(templateName, {
        dir: templateDownloadPath,
        force: shouldForce,
        offline: Boolean(ctx.args.offline),
        preferOffline: Boolean(ctx.args.preferOffline),
        registry: process.env.NUXI_INIT_REGISTRY || DEFAULT_REGISTRY,
      })

      if (dir.length > 0) {
        const path = await findFile('package.json', {
          startingFrom: join(templateDownloadPath, 'package.json'),
          reverse: true,
        })
        if (path) {
          const pkg = await readPackageJSON(path, { try: true })
          if (pkg && pkg.name) {
            const slug = basename(templateDownloadPath)
              .replace(NON_WORD_RE, '-')
              .replace(MULTI_DASH_RE, '-')
              .replace(LEADING_TRAILING_DASH_RE, '')
            if (slug) {
              pkg.name = slug
              await writePackageJSON(path, pkg)
            }
          }
        }
      }

      downloadSpinner.stop(`Downloaded ${colors.cyan(template.name)} template`)
    }
    catch (err) {
      downloadSpinner.error('Template download failed')
      if (process.env.DEBUG) {
        throw err
      }
      logger.error((err as Error).toString())
      process.exit(1)
    }

    if (ctx.args.nightly !== undefined && !ctx.args.offline && !ctx.args.preferOffline) {
      const nightlySpinner = spinner()
      nightlySpinner.start('Fetching nightly version info')

      const response = await $fetch<{ 'dist-tags': Record<string, string> }>('https://registry.npmjs.org/nuxt-nightly')
      const nightlyChannelTag = ctx.args.nightly || 'latest'

      if (!nightlyChannelTag) {
        nightlySpinner.error('Failed to get nightly channel tag')
        logger.error(`Error getting nightly channel tag.`)
        process.exit(1)
      }

      const nightlyChannelVersion = response['dist-tags'][nightlyChannelTag]

      if (!nightlyChannelVersion) {
        nightlySpinner.error('Nightly version not found')
        logger.error(`Nightly channel version for tag ${colors.cyan(nightlyChannelTag)} not found.`)
        process.exit(1)
      }

      const nightlyNuxtPackageJsonVersion = `npm:nuxt-nightly@${nightlyChannelVersion}`
      const packageJsonPath = resolve(cwd, dir)

      const packageJson = await readPackageJSON(packageJsonPath)

      if (packageJson.dependencies && 'nuxt' in packageJson.dependencies) {
        packageJson.dependencies.nuxt = nightlyNuxtPackageJsonVersion
      }
      else if (packageJson.devDependencies && 'nuxt' in packageJson.devDependencies) {
        packageJson.devDependencies.nuxt = nightlyNuxtPackageJsonVersion
      }

      await writePackageJSON(join(packageJsonPath, 'package.json'), packageJson)
      nightlySpinner.stop(`Updated to nightly version ${colors.cyan(nightlyChannelVersion)}`)
    }

    // Resolve package manager
    const packageManagerArg = ctx.args.packageManager as PackageManagerName
    const packageManagerSelectOptions = packageManagerOptions.map(pm => ({
      label: pm,
      value: pm,
      hint: currentPackageManager === pm ? 'current' : undefined,
    }))

    let selectedPackageManager: PackageManagerName
    if (packageManagerOptions.includes(packageManagerArg)) {
      selectedPackageManager = packageManagerArg
    }
    else if (isNonInteractive) {
      selectedPackageManager = currentPackageManager ?? 'npm'
    }
    else {
      const result = await select({
        message: 'Which package manager would you like to use?',
        options: packageManagerSelectOptions,
        initialValue: currentPackageManager,
      })

      if (isCancel(result)) {
        cancel('Operation cancelled.')
        process.exit(1)
      }

      selectedPackageManager = result
    }

    // Determine if we should init git
    let gitInit: boolean | undefined = ctx.args.gitInit === 'false' as unknown ? false : ctx.args.gitInit
    if (gitInit === undefined) {
      if (isNonInteractive) {
        gitInit = false
      }
      else {
        const result = await confirm({
          message: 'Initialize git repository?',
        })

        if (isCancel(result)) {
          cancel('Operation cancelled.')
          process.exit(1)
        }

        gitInit = result
      }
    }

    // Install project dependencies and initialize git
    // or skip installation based on the '--no-install' flag
    // citty v0.2.0 with node:util.parseArgs returns 'false' string for --install=false
    if (ctx.args.install === false || (ctx.args.install as unknown) === 'false') {
      logger.info('Skipping install dependencies step.')
    }
    else {
      const setupTasks: Array<{ title: string, task: () => Promise<string> }> = [
        {
          title: `Installing dependencies with ${colors.cyan(selectedPackageManager)}`,
          task: async () => {
            await installDependencies({
              cwd: template.dir,
              packageManager: {
                name: selectedPackageManager,
                command: selectedPackageManager,
              },
              silent: true,
            })
            return 'Dependencies installed'
          },
        },
      ]

      if (gitInit) {
        setupTasks.push({
          title: 'Initializing git repository',
          task: async () => {
            try {
              await x('git', ['init', template.dir], {
                throwOnError: true,
                nodeOptions: {
                  stdio: 'inherit',
                },
              })
              return 'Git repository initialized'
            }
            catch (err) {
              return `Git initialization failed: ${err}`
            }
          },
        })
      }

      try {
        await tasks(setupTasks)
      }
      catch (err) {
        if (process.env.DEBUG) {
          throw err
        }
        logger.error((err as Error).toString())
        process.exit(1)
      }
    }

    const modulesToAdd: string[] = []

    // Get modules from arg (if provided)
    if (ctx.args.modules !== undefined) {
      // ctx.args.modules is false when --no-modules is used
      for (const segment of (ctx.args.modules || '').split(',')) {
        const mod = segment.trim()
        if (mod) {
          modulesToAdd.push(mod)
        }
      }
    }

    // ...or offer to browse and install modules (if not offline)
    else if (!ctx.args.offline && !ctx.args.preferOffline) {
      if (!isNonInteractive) {
        const modulesPromise = fetchModules()
        const wantsUserModules = await confirm({
          message: `Would you like to browse and install modules?`,
          initialValue: false,
        })

        if (isCancel(wantsUserModules)) {
          cancel('Operation cancelled.')
          process.exit(1)
        }

        if (wantsUserModules) {
          const modulesSpinner = spinner()
          modulesSpinner.start('Fetching available modules')

          const [response, templateDeps, nuxtVersion] = await Promise.all([
            modulesPromise,
            getTemplateDependencies(template.dir),
            getNuxtVersion(template.dir),
          ])

          modulesSpinner.stop('Modules loaded')

          const allModules = response
            .filter(module =>
              module.npm !== '@nuxt/devtools'
              && !templateDeps.includes(module.npm)
              && (!module.compatibility.nuxt || checkNuxtCompatibility(module, nuxtVersion)),
            )

          if (allModules.length === 0) {
            logger.info('All modules are already included in this template.')
          }
          else {
            const result = await selectModulesAutocomplete({ modules: allModules })

            if (result.selected.length > 0) {
              const modules = result.selected

              const allDependencies = Object.fromEntries(
                await Promise.all(modules.map(async module =>
                  [module, await getModuleDependencies(module)] as const,
                )),
              )

              const { toInstall, skipped } = filterModules(modules, allDependencies)

              if (skipped.length) {
                logger.info(`The following modules are already included as dependencies of another module and will not be installed: ${skipped.map(m => colors.cyan(m)).join(', ')}`)
              }
              modulesToAdd.push(...toInstall)
            }
          }
        }
      }
    }

    // Add modules
    if (modulesToAdd.length > 0) {
      const args: string[] = [
        ...modulesToAdd,
        `--cwd=${templateDownloadPath}`,
        ctx.args.install ? '' : '--skipInstall',
        ctx.args.logLevel ? `--logLevel=${ctx.args.logLevel}` : '',
      ].filter(Boolean)

      await runCommand(addModuleCommand, args)
    }

    outro(`✨ Nuxt project has been created with the ${colors.cyan(template.name)} template.`)

    // Display next steps
    const relativeTemplateDir = relative(process.cwd(), template.dir) || '.'
    const runCmd = selectedPackageManager === 'deno' ? 'task' : 'run'
    const nextSteps = [
      !ctx.args.shell
      && relativeTemplateDir.length > 1
      && colors.cyan(`cd ${relativeTemplateDir}`),
      colors.cyan(`${selectedPackageManager} ${runCmd} dev`),
    ].filter(Boolean)

    box(`\n${nextSteps.map(step => ` › ${step}`).join('\n')}\n`, ` 👉 Next steps `, {
      contentAlign: 'left',
      titleAlign: 'left',
      width: 'auto',
      titlePadding: 2,
      contentPadding: 2,
      rounded: true,
      withGuide: false,
      formatBorder: (text: string) => `${themeColor + text}\x1B[0m`,
    })

    if (ctx.args.shell) {
      startShell(template.dir)
    }
  },
})

async function getModuleDependencies(moduleName: string) {
  try {
    const response = await $fetch(`https://registry.npmjs.org/${moduleName}/latest`)
    const dependencies = response.dependencies || {}
    return Object.keys(dependencies)
  }
  catch (err) {
    logger.warn(`Could not get dependencies for ${colors.cyan(moduleName)}: ${err}`)
    return []
  }
}

function filterModules(modules: string[], allDependencies: Record<string, string[]>) {
  const result = {
    toInstall: [] as string[],
    skipped: [] as string[],
  }

  for (const module of modules) {
    const isDependency = modules.some((otherModule) => {
      if (otherModule === module)
        return false
      const deps = allDependencies[otherModule] || []
      return deps.includes(module)
    })

    if (isDependency) {
      result.skipped.push(module)
    }
    else {
      result.toInstall.push(module)
    }
  }

  return result
}

async function getTemplateDependencies(templateDir: string) {
  try {
    const packageJsonPath = join(templateDir, 'package.json')
    if (!existsSync(packageJsonPath)) {
      return []
    }
    const packageJson = await readPackageJSON(packageJsonPath)
    const directDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    }
    const directDepNames = Object.keys(directDeps)
    const allDeps = new Set(directDepNames)

    const transitiveDepsResults = await Promise.all(
      directDepNames.map(dep => getModuleDependencies(dep)),
    )

    transitiveDepsResults.forEach((deps) => {
      deps.forEach(dep => allDeps.add(dep))
    })

    return [...allDeps]
  }
  catch (err) {
    logger.warn(`Could not read template dependencies: ${err}`)
    return []
  }
}

function detectCurrentPackageManager() {
  const userAgent = process.env.npm_config_user_agent
  if (!userAgent) {
    return
  }
  const [name] = userAgent.split('/')
  if (packageManagerOptions.includes(name as PackageManagerName)) {
    return name as PackageManagerName
  }
}
