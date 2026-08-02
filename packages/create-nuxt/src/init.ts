import type { ArgsDef, CommandDef } from 'citty'
import type { DownloadTemplateResult } from 'giget'
import type { PackageManagerName } from 'nypm'
import type { InstallResult } from '../../nuxt-cli/src/utils/install'
import type { TemplateData } from '../../nuxt-cli/src/utils/starter-templates'

import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import process from 'node:process'

import { styleText } from 'node:util'
import { cancel, confirm, intro, isCancel, outro, S_BAR, select, spinner, text } from '@clack/prompts'
import { defineCommand, showUsage } from 'citty'
import { downloadTemplate, startShell } from 'giget'
import { detectPackageManager } from 'nypm'
import { basename, join, relative, resolve } from 'pathe'
import { findFile, readPackageJSON, writePackageJSON } from 'pkg-types'
import { hasTTY } from 'std-env'
import { x } from 'tinyexec'

import { cwdArgs, logLevelArgs } from '../../nuxt-cli/src/commands/_shared'
import { selectModulesAutocomplete } from '../../nuxt-cli/src/commands/module/_autocomplete'
import { checkNuxtCompatibility, fetchModules, MODULES_API_URL } from '../../nuxt-cli/src/commands/module/_utils'
import addModuleCommand from '../../nuxt-cli/src/commands/module/add'
import { runCommandDef as runCommand } from '../../nuxt-cli/src/run-command'
import { nuxtIcon, themeColor } from '../../nuxt-cli/src/utils/ascii'
import { fetchJson } from '../../nuxt-cli/src/utils/fetch'
import { formatHeadlessCommand } from '../../nuxt-cli/src/utils/headless'
import { createInstallLog, resolvePackageManagerDescriptor, runInstall, takeUnreportedIgnoredBuilds } from '../../nuxt-cli/src/utils/install'
import { debug, logger } from '../../nuxt-cli/src/utils/logger'
import { classifyNetworkError, describeNetworkError, logNetworkError, probeNetworkError } from '../../nuxt-cli/src/utils/network'
import { relativeToProcess } from '../../nuxt-cli/src/utils/paths'
import { getTemplates, TEMPLATES_API_URL } from '../../nuxt-cli/src/utils/starter-templates'
import { getNuxtVersion } from '../../nuxt-cli/src/utils/versions'

const NON_WORD_RE = /[^\w-]/g
const MULTI_DASH_RE = /-{2,}/g
const LEADING_TRAILING_DASH_RE = /^-|-$/g

const DEFAULT_REGISTRY = 'https://raw.githubusercontent.com/nuxt/starter/templates/templates'
const DEFAULT_TEMPLATE_NAME = 'minimal'
const NIGHTLY_DIST_TAGS_URL = 'https://registry.npmjs.org/nuxt-nightly'

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
      .map(([name, data]) => `  ${styleText('cyan', name)}${data ? ` – ${data.description}` : ''}`)
      .join('\n')}`)
  }
  const label = missingArgs.length === 1 ? 'argument' : 'arguments'
  logger.error(`Non-interactive terminal detected. Missing required ${label}: ${missingArgs
    .map(name => styleText('cyan', name === 'dir' ? '<dir>' : `--${name}`))
    .join(', ')}`)
}

const YARN_NODE_LINKER = `# Nuxt cannot resolve its modules under Yarn's default Plug'n'Play linker.
# See https://github.com/nuxt/nuxt/issues/26750
nodeLinker: node-modules
`

/**
 * Opt a scaffolded project out of Yarn's Plug'n'Play linker, under which
 * `nuxt prepare` cannot resolve `@nuxt/kit` and the project will not build.
 *
 * Templates that ship any Yarn configuration of their own are left alone, so a
 * template can still choose Plug'n'Play. Yarn 1 ignores `.yarnrc.yml`, so
 * writing it there is harmless.
 */
export async function useYarnNodeModulesLinker(dir: string): Promise<boolean> {
  if (existsSync(join(dir, '.yarnrc.yml')) || existsSync(join(dir, '.yarnrc'))) {
    return false
  }
  await writeFile(join(dir, '.yarnrc.yml'), YARN_NODE_LINKER, 'utf8')
  return true
}

/**
 * Commands to print in the closing 'Next steps' section, in the order to run them.
 *
 * `dir` is relative to the current working directory, so `.` means the project
 * was created in place and there is nowhere to `cd` to.
 */
export function getNextSteps(options: {
  dir: string
  shell: boolean
  installFailure?: unknown
  installSkipped?: boolean
  recoveryCommands: string[]
  packageManager: PackageManagerName
}): string[] {
  const { dir, shell, installFailure, installSkipped, recoveryCommands, packageManager } = options
  const runCmd = packageManager === 'deno' ? 'task' : 'run'
  return [
    !shell && dir !== '.' && `cd ${dir}`,
    (installFailure || installSkipped) && `${packageManager} install`,
    ...recoveryCommands,
    `${packageManager} ${runCmd} dev`,
  ].filter((step): step is string => typeof step === 'string')
}

export default defineCommand({
  meta: {
    name: 'init',
    description: 'Initialize a fresh project',
  },
  args: {
    ...cwdArgs,
    cwd: {
      ...cwdArgs.cwd,
      description: 'Specify the directory to create the project in',
    },
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
      logger.error(`Invalid package manager: ${styleText('cyan', ctx.args.packageManager)}. Choose one of ${packageManagerOptions.map(pm => styleText('cyan', pm)).join(', ')}.`)
      process.exit(ARG_ERROR_EXIT_CODE)
    }

    // citty v0.2.0 with node:util.parseArgs returns the string 'false' for --install=false
    const installRequested = ctx.args.install !== false && (ctx.args.install as unknown) !== 'false'

    if (!ctx.args.offline && !ctx.args.preferOffline && !ctx.args.template) {
      getTemplates().catch(() => null)
    }

    if (hasTTY) {
      process.stdout.write(`\n${nuxtIcon}\n\n`)
    }

    intro(styleText('bold', `Welcome to Nuxt!`.split('').map(m => `${themeColor}${m}`).join('')))

    let availableTemplates: Record<string, TemplateData> = {}

    // Whether any of the project's shape came from a prompt. With every answer
    // already given as an argument there is nothing to teach the user.
    let prompted = false

    if (!ctx.args.template || !ctx.args.dir) {
      const defaultTemplates = await import('../../nuxt-cli/src/data/templates').then(r => r.templates)
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
        catch (err) {
          availableTemplates = defaultTemplates
          debug(describeNetworkError(err, TEMPLATES_API_URL))
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
            label: data ? `${styleText('whiteBright', name)} – ${data.description}` : name,
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
      prompted = true
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
      prompted = true
    }

    const cwd = resolve(ctx.args.cwd)
    let templateDownloadPath = resolve(cwd, dir)
    logger.step(`Creating project in ${styleText('cyan', relativeToProcess(templateDownloadPath))}`)

    let shouldForce = Boolean(ctx.args.force)

    // Prompt the user if the template download directory already exists
    // when no `--force` flag is provided
    const shouldVerify = !shouldForce && existsSync(templateDownloadPath)
    if (shouldVerify) {
      if (isNonInteractive) {
        logger.error(`The directory ${styleText('cyan', relativeToProcess(templateDownloadPath))} already exists. Pass ${styleText('cyan', '--force')} to override it or choose a different directory.`)
        process.exit(1)
      }

      const selectedAction = await select({
        message: `The directory ${styleText('cyan', relativeToProcess(templateDownloadPath))} already exists. What would you like to do?`,
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

    const registry = process.env.NUXI_INIT_REGISTRY || DEFAULT_REGISTRY

    const downloadSpinner = spinner()
    downloadSpinner.start(`Downloading ${styleText('cyan', templateName)} template`)

    try {
      template = await downloadTemplate(templateName, {
        dir: templateDownloadPath,
        force: shouldForce,
        offline: Boolean(ctx.args.offline),
        preferOffline: Boolean(ctx.args.preferOffline),
        registry,
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

      downloadSpinner.stop(`Downloaded ${styleText('cyan', template.name)} template`)
    }
    catch (err) {
      downloadSpinner.error('Template download failed')
      if (process.env.DEBUG) {
        throw err
      }
      const diagnosable = classifyNetworkError(err).kind === 'unknown'
        ? await probeNetworkError(registry) ?? err
        : err
      logNetworkError(diagnosable, {
        url: registry,
        hints: [
          `Retry with ${styleText('cyan', '--offline')} or ${styleText('cyan', '--preferOffline')} to use a cached template, or set ${styleText('cyan', 'NUXI_INIT_REGISTRY')} to a reachable mirror.`,
        ],
      })
      process.exit(1)
    }

    if (ctx.args.nightly !== undefined && !ctx.args.offline && !ctx.args.preferOffline) {
      const nightlySpinner = spinner()
      nightlySpinner.start('Fetching nightly version info')

      const response = await fetchJson<{ 'dist-tags': Record<string, string> }>(NIGHTLY_DIST_TAGS_URL).catch((err) => {
        nightlySpinner.error('Failed to fetch nightly version info')
        logNetworkError(err, { url: NIGHTLY_DIST_TAGS_URL })
        process.exit(1)
      })
      const nightlyChannelTag = ctx.args.nightly || 'latest'

      if (!nightlyChannelTag) {
        nightlySpinner.error('Failed to get nightly channel tag')
        logger.error(`Error getting nightly channel tag.`)
        process.exit(1)
      }

      const nightlyChannelVersion = response['dist-tags'][nightlyChannelTag]

      if (!nightlyChannelVersion) {
        nightlySpinner.error('Nightly version not found')
        logger.error(`Nightly channel version for tag ${styleText('cyan', nightlyChannelTag)} not found.`)
        process.exit(1)
      }

      const nightlyNuxtPackageJsonVersion = `npm:nuxt-nightly@${nightlyChannelVersion}`
      const packageJsonPath = join(template.dir, 'package.json')

      const packageJson = await readPackageJSON(packageJsonPath)

      if (packageJson.dependencies && 'nuxt' in packageJson.dependencies) {
        packageJson.dependencies.nuxt = nightlyNuxtPackageJsonVersion
      }
      else if (packageJson.devDependencies && 'nuxt' in packageJson.devDependencies) {
        packageJson.devDependencies.nuxt = nightlyNuxtPackageJsonVersion
      }

      await writePackageJSON(packageJsonPath, packageJson)
      nightlySpinner.stop(`Updated to nightly version ${styleText('cyan', nightlyChannelVersion)}`)
    }

    let installFailure: InstallResult | undefined
    let ignoredBuilds: string[] = []
    // Commands the user still has to run before the project works, surfaced in
    // the closing "Next steps" section rather than as separate notes.
    const recoveryCommands: string[] = []

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
        logger.warn(`The ${styleText('cyan', template.name)} template is configured for ${styleText('cyan', templatePackageManager.name)}, but ${styleText('cyan', packageManagerArg)} was requested. Skipping dependency installation to avoid installing against ${styleText('cyan', templatePackageManager.name)}'s lockfile and config. Reconcile the package manager (or use ${styleText('cyan', templatePackageManager.name)}) and install manually.`)
      }
    }
    else if (templatePackageManager) {
      selectedPackageManager = templatePackageManager.name
      const pinned = templatePackageManager.version
        ? `${templatePackageManager.name}@${templatePackageManager.version}`
        : templatePackageManager.name
      logger.info(`Using ${styleText('cyan', pinned)} as configured by the ${styleText('cyan', template.name)} template.`)
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
      prompted = true
    }

    if (selectedPackageManager === 'yarn' && await useYarnNodeModulesLinker(template.dir)) {
      logger.info(`Created ${styleText('cyan', '.yarnrc.yml')} with ${styleText('cyan', 'nodeLinker: node-modules')}, as Nuxt cannot resolve its modules under Yarn's Plug'n'Play linker.`)
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
      prompted = true
    }

    // Install project dependencies and initialize git
    // or skip installation based on the '--no-install' flag
    if (!installRequested || skipInstallOnConflict) {
      if (!skipInstallOnConflict) {
        logger.info('Skipping install dependencies step.')
      }
    }
    else {
      const installController = new AbortController()
      const installLog = createInstallLog({ verbose: isVerbose(ctx.args.logLevel) })
      const installSpinner = spinner({
        indicator: 'timer',
        onCancel: () => installController.abort(),
      })

      installSpinner.start(`Installing dependencies with ${styleText('cyan', selectedPackageManager)}`)

      const result = await runInstall({
        cwd: template.dir,
        packageManager: resolvePackageManagerDescriptor(
          selectedPackageManager,
          templatePackageManager?.name === selectedPackageManager ? templatePackageManager.version : undefined,
        ),
        onOutput: installLog.onOutput,
        onStatus: message => installSpinner.message(message),
        signal: installController.signal,
      })

      if (result.success) {
        installSpinner.stop('Dependencies installed')
        ignoredBuilds = takeUnreportedIgnoredBuilds(result.ignoredBuilds)
      }
      else {
        installFailure = result
        installSpinner.error(result.error ?? 'Dependency installation failed')
      }

      installLog.finish(result)

      // `approve-builds` is a pnpm command, so only pnpm gets the offer even if
      // another package manager ever prints the same notice.
      if (ignoredBuilds.length > 0 && selectedPackageManager === 'pnpm') {
        logger.warn(`${styleText('cyan', 'pnpm')} did not run build scripts for ${ignoredBuilds.map(name => styleText('cyan', name)).join(', ')}.`)

        const approve = isNonInteractive
          ? false
          : await confirm({ message: 'Approve build scripts now?', initialValue: false })

        if (approve === true) {
          await x('pnpm', ['approve-builds'], {
            throwOnError: false,
            nodeOptions: { cwd: template.dir, stdio: 'inherit' },
          })
        }
        else {
          recoveryCommands.push('pnpm approve-builds')
        }
      }
    }

    if (gitInit) {
      const gitSpinner = spinner()
      gitSpinner.start('Initializing git repository')

      const git = await x('git', ['init'], {
        throwOnError: false,
        nodeOptions: { cwd: template.dir },
      })
      if (git.exitCode === 0) {
        gitSpinner.stop('Git repository initialized')
      }
      else {
        gitSpinner.error('Git initialization failed')
        logger.message(git.stderr.trim().split('\n'), { symbol: styleText('gray', S_BAR) })
      }
    }

    const modulesToAdd: string[] = []
    // `ctx.args.modules` is `false` when --no-modules is used and `undefined`
    // when the user has not decided either way.
    const requestedModules = typeof ctx.args.modules === 'string'
      ? ctx.args.modules.split(',').map(segment => segment.trim()).filter(Boolean)
      : []

    // A project whose dependencies are missing cannot resolve modules, and
    // adding them to `nuxt.config` anyway would leave it unable to boot.
    if (installFailure) {
      if (requestedModules.length) {
        logger.warn(`Skipping module installation. Add ${requestedModules.map(mod => styleText('cyan', mod)).join(', ')} with ${styleText('cyan', 'nuxt module add')} once dependencies are installed.`)
      }
    }

    // Get modules from arg (if provided)
    else if (ctx.args.modules !== undefined) {
      modulesToAdd.push(...requestedModules)
    }

    // ...or offer to browse and install modules (if not offline nor non-interactive)
    else if (!ctx.args.offline && !ctx.args.preferOffline && !isNonInteractive) {
      // Requested before the prompt so the list is ready if the user says yes,
      // but a failure is only reported to users who asked for it (and never
      // while the prompt is on screen).
      let modulesError: unknown
      const modulesPromise = fetchModules().catch((err) => {
        modulesError = err
        return []
      })
      const wantsUserModules = await confirm({
        message: `Would you like to browse and install modules?`,
        initialValue: false,
      })

      if (isCancel(wantsUserModules)) {
        cancel('Operation cancelled.')
        process.exit(1)
      }

      prompted = true

      if (wantsUserModules) {
        const modulesSpinner = spinner()
        modulesSpinner.start('Fetching available modules')

        const [response, templateDeps, nuxtVersion] = await Promise.all([
          modulesPromise,
          getTemplateDependencies(template.dir),
          getNuxtVersion(template.dir),
        ])

        if (modulesError) {
          modulesSpinner.error('Failed to fetch available modules')
          logNetworkError(modulesError, { url: MODULES_API_URL, level: 'warn', prefix: 'Could not load the Nuxt Modules database.' })
        }
        else {
          modulesSpinner.stop('Modules loaded')
        }

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
              logger.info(`The following modules are already included as dependencies of another module and will not be installed: ${skipped.map(m => styleText('cyan', m)).join(', ')}`)
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
        `--cwd=${template.dir}`,
        installRequested && !skipInstallOnConflict ? '' : '--skipInstall',
        `--packageManager=${selectedPackageManager}`,
        ctx.args.logLevel ? `--logLevel=${ctx.args.logLevel}` : '',
      ].filter(Boolean)

      await runCommand(addModuleCommand, args)
    }

    if (installFailure) {
      logger.warn(`Created your project from the ${styleText('cyan', template.name)} template, but its dependencies are not installed.`)
    }
    else {
      logger.step(`Created your project from the ${styleText('cyan', template.name)} template`)
    }

    // The command carries no `--cwd`, so both it and the next steps are
    // written to be run from the directory the user is already in.
    const projectDir = relative(process.cwd(), template.dir) || '.'

    if (hasTTY && prompted) {
      const headlessCommand = formatHeadlessCommand({
        // Two columns for the gutter clack puts in front of each line, and one
        // of slack so a full line never wraps in the terminal itself.
        width: Math.max((process.stdout.columns || 80) - 3, 40),
        dir: projectDir,
        template: templateName,
        packageManager: selectedPackageManager,
        gitInit: Boolean(gitInit),
        install: installRequested,
        force: shouldForce,
        // `modulesToAdd` is empty when a failed install stopped us adding the
        // modules that were asked for, which the command should still request.
        modules: modulesToAdd.length ? modulesToAdd : requestedModules,
        nightly: ctx.args.nightly,
      })
      logger.info([
        'to scaffold this project again without prompts:',
        ...headlessCommand.map(line => styleText('dim', line)),
      ].join('\n'))
    }

    const nextSteps = getNextSteps({
      dir: projectDir,
      shell: !!ctx.args.shell,
      installFailure,
      installSkipped: !installRequested && !skipInstallOnConflict,
      recoveryCommands,
      packageManager: selectedPackageManager,
    })

    logger.message([
      'Next steps:',
      ...nextSteps.map(step => `› ${styleText('cyan', step)}`),
    ], { symbol: styleText('gray', S_BAR) })

    outro('✨ Happy building!')

    if (installFailure) {
      process.exitCode = 1
    }

    if (ctx.args.shell) {
      startShell(template.dir)
    }
  },
})

async function getModuleDependencies(moduleName: string) {
  const url = `https://registry.npmjs.org/${moduleName}/latest`
  try {
    const response = await fetchJson<{ dependencies?: Record<string, string> }>(url)
    const dependencies = response.dependencies || {}
    return Object.keys(dependencies)
  }
  catch (err) {
    logNetworkError(err, { url, level: 'warn', prefix: `Could not get dependencies for ${styleText('cyan', moduleName)}.` })
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

function isVerbose(logLevel?: string) {
  return logLevel === 'verbose' || Boolean(process.env.DEBUG)
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
