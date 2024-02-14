import { downloadTemplate, startShell } from 'giget'
import type { DownloadTemplateResult } from 'giget'
import { relative, resolve } from 'pathe'
import { consola } from 'consola'
import { installDependencies } from 'nypm'
import type { PackageManagerName } from 'nypm'
import { defineCommand } from 'citty'

import { sharedArgs } from './_shared'

const DEFAULT_REGISTRY =
  'https://raw.githubusercontent.com/nuxt/starter/templates/templates'
const DEFAULT_TEMPLATE_NAME = 'v3'

export default defineCommand({
  meta: {
    name: 'init',
    description: 'Initialize a fresh project',
  },
  args: {
    ...sharedArgs,
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
    const cwd = resolve(ctx.args.cwd || '.')

    // Get template name
    const templateName = ctx.args.template || DEFAULT_TEMPLATE_NAME

    if (typeof templateName !== 'string') {
      consola.error('Please specify a template!')
      process.exit(1)
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
    } catch (err) {
      if (process.env.DEBUG) {
        throw err
      }
      consola.error((err as Error).toString())
      process.exit(1)
    }

    // Resolve package manager
    const packageManagerOptions: PackageManagerName[] = [
      'npm',
      'pnpm',
      'yarn',
      'bun',
    ]
    const packageManagerArg = ctx.args.packageManager as PackageManagerName
    const selectedPackageManager = packageManagerOptions.includes(
      packageManagerArg,
    )
      ? packageManagerArg
      : await consola.prompt('Which package manager would you like to use?', {
          type: 'select',
          options: packageManagerOptions,
        })

    // Install project dependencies
    // or skip installation based on the '--no-install' flag
    if (ctx.args.install === false) {
      consola.info('Skipping install dependencies step.')
    } else {
      consola.start('Installing dependencies...')

      try {
        await installDependencies({
          cwd: template.dir,
          packageManager: {
            name: selectedPackageManager,
            command: selectedPackageManager,
          },
        })
      } catch (err) {
        if (process.env.DEBUG) {
          throw err
        }
        consola.error((err as Error).toString())
        process.exit(1)
      }

      consola.success('Installation completed.')
    }

    if (ctx.args.gitInit === undefined) {
      ctx.args.gitInit = await consola.prompt('Initialize git repository?', {
        type: 'confirm',
      })
    }
    if (ctx.args.gitInit) {
      consola.info('Initializing git repository...\n')
      const { execaCommand } = await import('execa')
      await execaCommand(`git init ${template.dir}`, {
        stdio: 'inherit',
      }).catch((err) => {
        consola.warn(`Failed to initialize git repository: ${err}`)
      })
    }

    // Display next steps
    consola.log(
      `\n✨ Nuxt project has been created with the \`${template.name}\` template. Next steps:`,
    )
    const relativeTemplateDir = relative(process.cwd(), template.dir) || '.'
    const nextSteps = [
      !ctx.args.shell &&
        relativeTemplateDir.length > 1 &&
        `\`cd ${relativeTemplateDir}\``,
      `Start development server with \`${selectedPackageManager} run dev\``,
    ].filter(Boolean)

    for (const step of nextSteps) {
      consola.log(` › ${step}`)
    }

    if (ctx.args.shell) {
      startShell(template.dir)
    }
  },
})
