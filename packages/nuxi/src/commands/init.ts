import type { ArgsDef, CommandDef } from 'citty'
import type { DownloadTemplateResult } from 'giget'
import type { PackageManagerName } from 'nypm'
import type { TemplateData } from '../utils/starter-templates'

import { existsSync } from 'node:fs'
import process from 'node:process'

import { box, cancel, confirm, intro, isCancel, outro, select, spinner, tasks, text } from '@clack/prompts'
import { defineCommand, showUsage } from 'citty'
import { colors } from 'consola/utils'
import { downloadTemplate, startShell } from 'giget'
import { detectPackageManager, installDependencies } from 'nypm'
import { $fetch } from 'ofetch'
import { basename, join, relative, resolve } from 'pathe'
import { findFile, readPackageJSON, writePackageJSON } from 'pkg-types'
import { hasTTY } from 'std-env'
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
  aube: undefined,
  nub: undefined,
}

// this is for type safety to prompt updating code in nuxi when nypm adds a new package manager
const packageManagerOptions = Object.keys(pms) as PackageManagerName[]

// Arguments that would otherwise be gathered through interactive prompts,
// so they must be explicitly provided when no TTY is available
const nonInteractiveRequiredArgs = ['dir', 'template', 'packageManager', 'gitInit'] as const

// Exit code citty uses for argument errors; reuse it for every missing/invalid
// argument so the contract stays consistent regardless of where we detect it.
const ARG_ERROR_EXIT_CODE = 2

/**
 * Report missing arguments in non-interactive mode. Centralises the message so
 * the upfront check and the post-detection package-manager check stay in sync.
 * Pass `availableTemplates` to also list the templates the user can choose from
 * (when `--template` is missing). Callers are expected to `process.exit` after.
 */
async function reportMissingNonInteractiveArgs<T extends ArgsDef>(
  cmd: CommandDef<T>,
  missingArgs: string[],
  availableTemplates?: Record<string, TemplateData>,
): Promise<void> {
  await showUsage(cmd)
  if (availableTemplates) {
    logger.info(`Available templates:\n${Object.entries(availableTemplates)
      .map(([name, data]) => `  ${colors.cyan(name)}${data ? ` – ${data.description}` : ''}`)
      .join('\n')}`)
  }
  const label = missingArgs.length === 1 ? 'argument' : 'arguments'
  logger.error(`Non-interactive terminal detected. Missing required ${label}: ${missingArgs
    .map(name => colors.cyan(name === 'dir' ? '<dir>' : `--${name}`))
    .join(', ')}`)
}

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
      description: `Package manager choice (${packageManagerOptions.join(', ')})`,
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
  },
  async run(ctx) {
    // Validate an explicitly provided `--packageManager` up front (before any
    // banner or network work) so a typo fails fast with a clear message instead
    // of being silently ignored once a template's own package manager is
    // detected.
    if (ctx.args.packageManager && !packageManagerOptions.includes(ctx.args.packageManager as PackageManagerName)) {
      logger.error(`Invalid package manager: ${colors.cyan(ctx.args.packageManager)}. Choose one of ${packageManagerOptions.map(pm => colors.cyan(pm)).join(', ')}.`)
      process.exit(ARG_ERROR_EXIT_CODE)
    }

    if (!ctx.args.offline && !ctx.args.preferOffline && !ctx.args.template) {
      getTemplates().catch(() => null)
    }

    if (hasTTY) {
      process.stdout.write(`\n${nuxtIcon}\n\n`)
    }

    intro(colors.bold(`Welcome to Nuxt!`.split('').map(m => `${themeColor}${m}`).join('')))

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

    // When no interactive terminal is available (e.g. agents, CI, piped input),
    // all arguments normally gathered through prompts must be provided up front.
    // Otherwise, show the help so the command can be re-run with proper arguments.
    const isNonInteractive = !hasTTY
    if (isNonInteractive) {
      const missingArgs = nonInteractiveRequiredArgs.filter((name) => {
        if (name === 'packageManager') {
          // The package manager can be inferred from a template that pins one,
          // so only require it upfront when no template is given (nothing to
          // infer from yet). Otherwise it's validated after the template is
          // downloaded and its package manager resolved.
          if (ctx.args.template) {
            return false
          }
          return !packageManagerOptions.includes(ctx.args.packageManager as PackageManagerName)
        }
        return ctx.args[name] === undefined || ctx.args[name] === ''
      })

      if (missingArgs.length > 0) {
        await reportMissingNonInteractiveArgs(
          ctx.cmd,
          [...missingArgs],
          ctx.args.template ? undefined : availableTemplates,
        )
        process.exit(ARG_ERROR_EXIT_CODE)
      }
    }

    let templateName = ctx.args.template
    if (!templateName) {
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
        logger.error(`The directory ${colors.cyan(relativeToProcess(templateDownloadPath))} already exists. Pass ${colors.cyan('--force')} to override it or choose a different directory.`)
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
      logger.error(String(err))
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

    const currentPackageManager = detectCurrentPackageManager()
    // Resolve package manager
    const packageManagerArg = ctx.args.packageManager as PackageManagerName
    const packageManagerSelectOptions = packageManagerOptions.map(pm => ({
      label: pm,
      value: pm,
      hint: currentPackageManager === pm ? 'current' : undefined,
    }))

    // Detect the package manager the template ships with (via a lockfile or its
    // `packageManager` field). When the template pins one, we use it instead of
    // prompting: switching package managers would leave a stale lockfile or
    // workspace config (e.g. `pnpm-workspace.yaml`) behind and silently break
    // the project. Shipping a template that works across package managers (i.e.
    // without a lockfile) is left to the template author.
    const templatePackageManager = await detectTemplatePackageManager(template.dir)

    let selectedPackageManager: PackageManagerName
    // Set when an explicit `--packageManager` conflicts with the template's pin:
    // installing would run the requested package manager against the template's
    // lockfile and workspace config for a different one, leaving a broken
    // project. We won't mutate the template, so we scaffold it as-is and skip
    // the install, letting the user reconcile the package manager themselves.
    let skipInstallOnConflict = false
    if (packageManagerOptions.includes(packageManagerArg)) {
      selectedPackageManager = packageManagerArg
      if (templatePackageManager && templatePackageManager.name !== packageManagerArg) {
        skipInstallOnConflict = true
        logger.warn(`The ${colors.cyan(template.name)} template is configured for ${colors.cyan(templatePackageManager.name)}, but ${colors.cyan(packageManagerArg)} was requested. Skipping dependency installation to avoid installing against ${colors.cyan(templatePackageManager.name)}'s lockfile and config. Reconcile the package manager (or use ${colors.cyan(templatePackageManager.name)}) and install manually.`)
      }
    }
    else if (templatePackageManager) {
      selectedPackageManager = templatePackageManager.name
      const pinned = templatePackageManager.version
        ? `${templatePackageManager.name}@${templatePackageManager.version}`
        : templatePackageManager.name
      logger.info(`Using ${colors.cyan(pinned)} as configured by the ${colors.cyan(template.name)} template.`)
    }
    else if (isNonInteractive) {
      // No explicit `--packageManager`, the template pins none, and we can't
      // prompt without a TTY, so there's nothing left to fall back to.
      await reportMissingNonInteractiveArgs(ctx.cmd, ['packageManager'])
      process.exit(ARG_ERROR_EXIT_CODE)
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
      const result = await confirm({
        message: 'Initialize git repository?',
      })

      if (isCancel(result)) {
        cancel('Operation cancelled.')
        process.exit(1)
      }

      gitInit = result
    }

    // Install project dependencies and initialize git
    // or skip installation based on the '--no-install' flag
    // citty v0.2.0 with node:util.parseArgs returns 'false' string for --install=false
    if (ctx.args.install === false || (ctx.args.install as unknown) === 'false' || skipInstallOnConflict) {
      if (!skipInstallOnConflict) {
        logger.info('Skipping install dependencies step.')
      }
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
        logger.error(String(err))
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

    // ...or offer to browse and install modules (if not offline nor non-interactive)
    else if (!ctx.args.offline && !ctx.args.preferOffline && !isNonInteractive) {
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

    // Add modules
    if (modulesToAdd.length > 0) {
      const args: string[] = [
        ...modulesToAdd,
        `--cwd=${templateDownloadPath}`,
        ctx.args.install && !skipInstallOnConflict ? '' : '--skipInstall',
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

export interface TemplatePackageManager {
  name: PackageManagerName
  version?: string
}

/**
 * Detect the package manager a template pins, scoped to the template directory
 * (so we don't pick up the parent project's setup) via its lockfile, marker
 * files or `packageManager` field. Returns `undefined` when the template pins
 * none, in which case it is package-manager agnostic and the user is free to
 * pick any. Detection errors are treated as "no pin".
 */
export async function detectTemplatePackageManager(templateDir: string): Promise<TemplatePackageManager | undefined> {
  const detected = await detectPackageManager(templateDir, {
    includeParentDirs: false,
    ignoreArgv: true,
  }).catch(() => undefined)

  if (!detected) {
    return
  }

  return { name: detected.name, version: detected.version }
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
