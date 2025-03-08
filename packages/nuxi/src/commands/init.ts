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

    // Resolve package manager
    const packageManagerArg = ctx.args.packageManager as PackageManagerName
    const selectedPackageManager = packageManagerOptions.includes(packageManagerArg)
      ? packageManagerArg
      : await logger.prompt('Which package manager would you like to use?', {
        type: 'select',
        options: packageManagerOptions,
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
    if (ctx.args.modules) {
      modulesToAdd.push(
        ...ctx.args.modules.split(',').map(module => module.trim()).filter(Boolean),
      )
    }
    // ...or offer to install official modules (if not offline)
    else if (!ctx.args.offline && !ctx.args.preferOffline) {
      const response = await $fetch<{
        modules: {
          npm: string
          type: 'community' | 'official'
          description: string
        }[]
      }>('https://api.nuxt.com/modules')

      const officialModules = response.modules
        .filter(module => module.type === 'official' && module.npm !== '@nuxt/devtools')

      const selectedOfficialModules = await logger.prompt(
        `Would you like to install any of the official modules?`,
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
        modulesToAdd.push(...(selectedOfficialModules as unknown as string[]))
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
