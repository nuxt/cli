import type { DownloadTemplateResult } from 'giget'
import type { PackageManagerName } from 'nypm'

import { existsSync } from 'node:fs'

import process from 'node:process'
import { defineCommand } from 'citty'
import { downloadTemplate, startShell } from 'giget'
import { installDependencies } from 'nypm'
import { join, relative, resolve } from 'pathe'

import { x } from 'tinyexec'
import { logger } from '../utils/logger'
import { cwdArgs } from './_shared'

const DEFAULT_REGISTRY
  = 'https://raw.githubusercontent.com/nuxt/starter/templates/templates'
const DEFAULT_TEMPLATE_NAME = 'v3'

export default defineCommand({
  meta: {
    name: 'init',
    description: 'Initialize a fresh project',
  },
  args: {
    ...cwdArgs,
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
  },
  async run(ctx) {
    const cwd = resolve(ctx.args.cwd)

    // Get template name
    const templateName = ctx.args.template || DEFAULT_TEMPLATE_NAME

    if (typeof templateName !== 'string') {
      logger.error('Please specify a template!')
      process.exit(1)
    }

    // Prompt the user if the template download directory already exists
    // when no `--force` flag is provided
    if (!ctx.args.force) {
      const templateDownloadPath = join(cwd, ctx.args.dir)

      const templateDownloadDirExists = existsSync(templateDownloadPath)

      if (templateDownloadDirExists) {
        const selectedAction = await logger.prompt(
          `The directory \`${templateDownloadPath}\` already exists. What would you like to do?`,
          {
            type: 'select',
            options: ['Override its contents', 'Select different directory', 'Abort'],
          },
        )

        switch (selectedAction) {
          case 'Override its contents':
            (ctx.args.force as boolean) = true

            break

          case 'Select different directory':
            (ctx.args.dir as string) = await logger.prompt(
              'Please specify a different directory:',
              {
                type: 'text',
              },
            )

            break

          case 'Abort':
            logger.info('Initialization aborted.')
            process.exit(1)
        }
      }
    }

    // Download template
    let template: DownloadTemplateResult

    try {
      template = await downloadTemplate(templateName, {
        dir: ctx.args.dir,
        cwd,
        force: Boolean(ctx.args.force),
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
    const packageManagerOptions: PackageManagerName[] = [
      'npm',
      'pnpm',
      'yarn',
      'bun',
      'deno',
    ]
    const packageManagerArg = ctx.args.packageManager as PackageManagerName
    const selectedPackageManager = packageManagerOptions.includes(
      packageManagerArg,
    )
      ? packageManagerArg
      : await logger.prompt('Which package manager would you like to use?', {
        type: 'select',
        options: packageManagerOptions,
      })

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
      })
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
