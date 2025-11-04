import type { DownloadTemplateResult } from 'giget'
import type { PackageManagerName } from 'nypm'

import { existsSync } from 'node:fs'
import process from 'node:process'

import * as clack from '@clack/prompts'
import { defineCommand } from 'citty'
import { colors } from 'consola/utils'
import { downloadTemplate, startShell } from 'giget'
import { installDependencies } from 'nypm'
import { $fetch } from 'ofetch'
import { basename, join, relative, resolve } from 'pathe'
import { findFile, readPackageJSON, writePackageJSON } from 'pkg-types'
import { hasTTY } from 'std-env'

import { x } from 'tinyexec'
import { runCommand } from '../run'
import { nuxtIcon, themeColor } from '../utils/ascii'
import { logger } from '../utils/logger'
import { cwdArgs, logLevelArgs } from './_shared'
import addModuleCommand from './module/add'

const DEFAULT_REGISTRY = 'https://raw.githubusercontent.com/nuxt/starter/templates/templates'
const DEFAULT_TEMPLATE_NAME = 'v4'

const pms: Record<PackageManagerName, undefined> = {
  npm: undefined,
  pnpm: undefined,
  yarn: undefined,
  bun: undefined,
  deno: undefined,
}

// this is for type safety to prompt updating code in nuxi when nypm adds a new package manager
const packageManagerOptions = Object.keys(pms) as PackageManagerName[]

async function getModuleDependencies(moduleName: string) {
  try {
    const response = await $fetch(`https://registry.npmjs.org/${moduleName}/latest`)
    const dependencies = response.dependencies || {}
    return Object.keys(dependencies)
  }
  catch (err) {
    logger.warn(`Could not get dependencies for ${moduleName}: ${err}`)
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

    return Array.from(allDeps)
  }
  catch (err) {
    logger.warn(`Could not read template dependencies: ${err}`)
    return []
  }
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
  },
  async run(ctx) {
    if (hasTTY) {
      process.stdout.write(`\n${nuxtIcon}\n\n`)
    }

    logger.info(colors.bold(`Welcome to Nuxt!`.split('').map(m => `${themeColor}${m}`).join('')))

    if (ctx.args.dir === '') {
      const result = await clack.text({
        message: 'Where would you like to create your project?',
        placeholder: './nuxt-app',
        defaultValue: 'nuxt-app',
      })

      if (clack.isCancel(result)) {
        clack.cancel('Operation cancelled.')
        process.exit(1)
      }

      ctx.args.dir = result
    }

    const cwd = resolve(ctx.args.cwd)
    let templateDownloadPath = resolve(cwd, ctx.args.dir)
    logger.info(`Creating a new project in ${colors.cyan(relative(cwd, templateDownloadPath) || templateDownloadPath)}.`)

    // Get template name
    const templateName = ctx.args.template || DEFAULT_TEMPLATE_NAME

    if (typeof templateName !== 'string') {
      logger.error('Please specify a template!')
      process.exit(1)
    }

    let shouldForce = Boolean(ctx.args.force)

    // Prompt the user if the template download directory already exists
    // when no `--force` flag is provided
    const shouldVerify = !shouldForce && existsSync(templateDownloadPath)
    if (shouldVerify) {
      const selectedAction = await clack.select({
        message: `The directory ${colors.cyan(templateDownloadPath)} already exists. What would you like to do?`,
        options: [
          { value: 'override', label: 'Override its contents' },
          { value: 'different', label: 'Select different directory' },
          { value: 'abort', label: 'Abort' },
        ],
      })

      if (clack.isCancel(selectedAction)) {
        clack.cancel('Operation cancelled.')
        process.exit(1)
      }

      switch (selectedAction) {
        case 'override':
          shouldForce = true
          break

        case 'different': {
          const result = await clack.text({
            message: 'Please specify a different directory:',
          })

          if (clack.isCancel(result)) {
            clack.cancel('Operation cancelled.')
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

    try {
      template = await downloadTemplate(templateName, {
        dir: templateDownloadPath,
        force: shouldForce,
        offline: Boolean(ctx.args.offline),
        preferOffline: Boolean(ctx.args.preferOffline),
        registry: process.env.NUXI_INIT_REGISTRY || DEFAULT_REGISTRY,
      })

      if (ctx.args.dir.length > 0) {
        const path = await findFile('package.json', {
          startingFrom: join(templateDownloadPath, 'package.json'),
          reverse: true,
        })
        if (path) {
          const pkg = await readPackageJSON(path, { try: true })
          if (pkg && pkg.name) {
            const slug = basename(templateDownloadPath)
              .replace(/[^\w-]/g, '-')
              .replace(/-{2,}/g, '-')
              .replace(/^-|-$/g, '')
            if (slug) {
              pkg.name = slug
              await writePackageJSON(path, pkg)
            }
          }
        }
      }
    }
    catch (err) {
      if (process.env.DEBUG) {
        throw err
      }
      logger.error((err as Error).toString())
      process.exit(1)
    }

    if (ctx.args.nightly !== undefined && !ctx.args.offline && !ctx.args.preferOffline) {
      const response = await $fetch<{
        'dist-tags': {
          [key: string]: string
        }
      }>('https://registry.npmjs.org/nuxt-nightly')

      const nightlyChannelTag = ctx.args.nightly || 'latest'

      if (!nightlyChannelTag) {
        logger.error(`Error getting nightly channel tag.`)
        process.exit(1)
      }

      const nightlyChannelVersion = response['dist-tags'][nightlyChannelTag]

      if (!nightlyChannelVersion) {
        logger.error(`Nightly channel version for tag '${nightlyChannelTag}' not found.`)
        process.exit(1)
      }

      const nightlyNuxtPackageJsonVersion = `npm:nuxt-nightly@${nightlyChannelVersion}`
      const packageJsonPath = resolve(cwd, ctx.args.dir)

      const packageJson = await readPackageJSON(packageJsonPath)

      if (packageJson.dependencies && 'nuxt' in packageJson.dependencies) {
        packageJson.dependencies.nuxt = nightlyNuxtPackageJsonVersion
      }
      else if (packageJson.devDependencies && 'nuxt' in packageJson.devDependencies) {
        packageJson.devDependencies.nuxt = nightlyNuxtPackageJsonVersion
      }

      await writePackageJSON(join(packageJsonPath, 'package.json'), packageJson)
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

    const currentPackageManager = detectCurrentPackageManager()
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
    else {
      const result = await clack.select({
        message: 'Which package manager would you like to use?',
        options: packageManagerSelectOptions,
        initialValue: currentPackageManager,
      })

      if (clack.isCancel(result)) {
        clack.cancel('Operation cancelled.')
        process.exit(1)
      }

      selectedPackageManager = result
    }

    // Install project dependencies
    // or skip installation based on the '--no-install' flag
    if (ctx.args.install === false) {
      logger.info('Skipping install dependencies step.')
    }
    else {
      logger.start('Installing dependencies...')

      try {
        await installDependencies({
          cwd: template.dir,
          packageManager: {
            name: selectedPackageManager,
            command: selectedPackageManager,
          },
        })
      }
      catch (err) {
        if (process.env.DEBUG) {
          throw err
        }
        logger.error((err as Error).toString())
        process.exit(1)
      }

      logger.success('Installation completed.')
    }

    if (ctx.args.gitInit === undefined) {
      const result = await clack.confirm({
        message: 'Initialize git repository?',
      })

      if (clack.isCancel(result)) {
        clack.cancel('Operation cancelled.')
        process.exit(1)
      }

      ctx.args.gitInit = result
    }
    if (ctx.args.gitInit) {
      logger.info('Initializing git repository...\n')
      try {
        await x('git', ['init', template.dir], {
          throwOnError: true,
          nodeOptions: {
            stdio: 'inherit',
          },
        })
      }
      catch (err) {
        logger.warn(`Failed to initialize git repository: ${err}`)
      }
    }

    const modulesToAdd: string[] = []

    // Get modules from arg (if provided)
    if (ctx.args.modules !== undefined) {
      modulesToAdd.push(
        // ctx.args.modules is false when --no-modules is used
        ...(ctx.args.modules || '').split(',').map(module => module.trim()).filter(Boolean),
      )
    }
    // ...or offer to install official modules (if not offline)
    else if (!ctx.args.offline && !ctx.args.preferOffline) {
      const modulesPromise = $fetch<{
        modules: {
          npm: string
          type: 'community' | 'official'
          description: string
        }[]
      }>('https://api.nuxt.com/modules')

      const wantsUserModules = await clack.confirm({
        message: `Would you like to install any of the official modules?`,
        initialValue: false,
      })

      if (clack.isCancel(wantsUserModules)) {
        clack.cancel('Operation cancelled.')
        process.exit(1)
      }

      if (wantsUserModules) {
        const [response, templateDeps] = await Promise.all([
          modulesPromise,
          getTemplateDependencies(template.dir),
        ])

        const officialModules = response.modules
          .filter(module => module.type === 'official' && module.npm !== '@nuxt/devtools')
          .filter(module => !templateDeps.includes(module.npm))

        if (officialModules.length === 0) {
          logger.info('All official modules are already included in this template.')
        }
        else {
          const selectedOfficialModules = await clack.multiselect({
            message: 'Pick the modules to install:',
            options: officialModules.map(module => ({
              label: `${colors.bold(colors.greenBright(module.npm))} – ${module.description.replace(/\.$/, '')}`,
              value: module.npm,
            })),
            required: false,
          })

          if (clack.isCancel(selectedOfficialModules)) {
            process.exit(1)
          }

          if (selectedOfficialModules.length > 0) {
            const modules = selectedOfficialModules as unknown as string[]

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
        ctx.args.install ? '' : '--skipInstall',
        ctx.args.logLevel ? `--logLevel=${ctx.args.logLevel}` : '',
      ].filter(Boolean)

      await runCommand(addModuleCommand, args)
    }

    logger.log(`\n✨ Nuxt project has been created with the \`${template.name}\` template.\n`)

    // Display next steps
    const relativeTemplateDir = relative(process.cwd(), template.dir) || '.'
    const runCmd = selectedPackageManager === 'deno' ? 'task' : 'run'
    const nextSteps = [
      !ctx.args.shell
      && relativeTemplateDir.length > 1
      && colors.cyan(`cd ${relativeTemplateDir}`),
      colors.cyan(`${selectedPackageManager} ${runCmd} dev`),
    ].filter(Boolean)

    clack.box(`\n${nextSteps.map(step => ` › ${step}`).join('\n')}\n`, ` 👉 Next steps `, {
      contentAlign: 'left',
      titleAlign: 'left',
      width: 'auto',
      titlePadding: 2,
      contentPadding: 2,
      rounded: true,
      includePrefix: false,
      formatBorder: (text: string) => `${themeColor + text}\x1B[0m`,
    })

    if (ctx.args.shell) {
      startShell(template.dir)
    }
  },
})
