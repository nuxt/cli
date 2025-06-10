import type { SelectPromptOptions } from 'consola'
import type { DownloadTemplateResult } from 'giget'
import type { PackageManagerName } from 'nypm'

import { existsSync } from 'node:fs'
import process from 'node:process'

import { defineCommand } from 'citty'
import { colors } from 'consola/utils'
import { downloadTemplate, startShell } from 'giget'
import { installDependencies } from 'nypm'
import { $fetch } from 'ofetch'
import { join, relative, resolve } from 'pathe'
import { hasTTY } from 'std-env'

import { x } from 'tinyexec'
import { runCommand } from '../run'
import { nuxtIcon, themeColor } from '../utils/ascii'
import { logger } from '../utils/logger'
import { cwdArgs, logLevelArgs } from './_shared'

const DEFAULT_REGISTRY = 'https://raw.githubusercontent.com/nuxt/starter/templates/templates'
const DEFAULT_TEMPLATE_NAME = 'v3'

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
  },
  async run(ctx) {
    if (hasTTY) {
      process.stdout.write(`\n${nuxtIcon}\n\n`)
    }

    logger.info(colors.bold(`Welcome to Nuxt!`.split('').map(m => `${themeColor}${m}`).join('')))

    if (ctx.args.dir === '') {
      ctx.args.dir = await logger.prompt('Where would you like to create your project?', {
        placeholder: './nuxt-app',
        type: 'text',
        default: 'nuxt-app',
        cancel: 'reject',
      }).catch(() => process.exit(1))
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
      const selectedAction = await logger.prompt(
        `The directory ${colors.cyan(templateDownloadPath)} already exists. What would you like to do?`,
        {
          type: 'select',
          options: ['Override its contents', 'Select different directory', 'Abort'],
        },
      )

      switch (selectedAction) {
        case 'Override its contents':
          shouldForce = true
          break

        case 'Select different directory': {
          templateDownloadPath = resolve(cwd, await logger.prompt('Please specify a different directory:', {
            type: 'text',
            cancel: 'reject',
          }).catch(() => process.exit(1)))
          break
        }

        // 'Abort' or Ctrl+C
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
    }
    catch (err) {
      if (process.env.DEBUG) {
        throw err
      }
      logger.error((err as Error).toString())
      process.exit(1)
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
    } satisfies SelectPromptOptions['options'][number]))
    const selectedPackageManager = packageManagerOptions.includes(packageManagerArg)
      ? packageManagerArg
      : await logger.prompt('Which package manager would you like to use?', {
          type: 'select',
          options: packageManagerSelectOptions,
          initial: currentPackageManager,
          cancel: 'reject',
        }).catch(() => process.exit(1))

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
      ctx.args.gitInit = await logger.prompt('Initialize git repository?', {
        type: 'confirm',
        cancel: 'reject',
      }).catch(() => process.exit(1))
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

      const wantsUserModules = await logger.prompt(
        `Would you like to install any of the official modules?`,
        {
          type: 'confirm',
          cancel: 'reject',
        },
      ).catch(() => process.exit(1))

      if (wantsUserModules) {
        const response = await modulesPromise

        const officialModules = response.modules
          .filter(module => module.type === 'official' && module.npm !== '@nuxt/devtools')

        const selectedOfficialModules = await logger.prompt(
          'Pick the modules to install:',
          {
            type: 'multiselect',
            options: officialModules.map(module => ({
              label: `${colors.bold(colors.greenBright(module.npm))} – ${module.description.replace(/\.$/, '')}`,
              value: module.npm,
            })),
            required: false,
          },
        )

        if (selectedOfficialModules === undefined) {
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

    // Add modules
    if (modulesToAdd.length > 0) {
      const args: string[] = [
        'add',
        ...modulesToAdd,
        `--cwd=${join(ctx.args.cwd, ctx.args.dir)}`,
        ctx.args.install ? '' : '--skipInstall',
        ctx.args.logLevel ? `--logLevel=${ctx.args.logLevel}` : '',
      ].filter(Boolean)

      await runCommand('module', args)
    }

    // Display next steps
    logger.log(
      `\n✨ Nuxt project has been created with the \`${template.name}\` template. Next steps:`,
    )
    const relativeTemplateDir = relative(process.cwd(), template.dir) || '.'
    const runCmd = selectedPackageManager === 'deno' ? 'task' : 'run'
    const nextSteps = [
      !ctx.args.shell
      && relativeTemplateDir.length > 1
      && `\`cd ${relativeTemplateDir}\``,
      `Start development server with \`${selectedPackageManager} ${runCmd} dev\``,
    ].filter(Boolean)

    for (const step of nextSteps) {
      logger.log(` › ${step}`)
    }

    if (ctx.args.shell) {
      startShell(template.dir)
    }
  },
})
