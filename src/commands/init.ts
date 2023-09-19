import { writeFile } from 'node:fs/promises'
import { downloadTemplate, startShell } from 'giget'
import type { DownloadTemplateResult } from 'giget'
import { relative, resolve } from 'pathe'
import { consola } from 'consola'
import { installDependencies } from 'nypm'
import type { PackageManagerName } from 'nypm'
import { defineCommand } from 'citty'

import { sharedArgs } from './_shared'
import { getIsGitInstalled, initializeGit } from '../utils/git'

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
    'git-init': {
      type: 'boolean',
      description: 'initialize git',
    },
    shell: {
      type: 'boolean',
      description: 'Start shell after installation in project directory',
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

    // Prompt user to select package manager
    const selectedPackageManager = await consola.prompt<{
      type: 'select'
      options: PackageManagerName[]
    }>('Which package manager would you like to use?', {
      type: 'select',
      options: ['npm', 'pnpm', 'yarn', 'bun'],
    })

    // Get relative project path
    const relativeProjectPath = relative(process.cwd(), template.dir)

    // Write .nuxtrc with `shamefully-hoist=true` for pnpm
    if (selectedPackageManager === 'pnpm') {
      await writeFile(`${relativeProjectPath}/.npmrc`, 'shamefully-hoist=true')
    }

    // Install project dependencies
    // or skip installation based on the '--no-install' flag
    if (ctx.args.install === false) {
      consola.info('Skipping install dependencies step.')
    } else {
      consola.start('Installing dependencies...')

      try {
        await installDependencies({
          cwd: relativeProjectPath,
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

    if (ctx.args?.['git-init']) {
      const isGitInstalled = await getIsGitInstalled()

      if (isGitInstalled) {
        initializeGit(cwd, ctx.args.dir || 'nuxt-app')
      }
    }

    // Display next steps
    consola.log(
      `\n✨ Nuxt project has been created with the \`${template.name}\` template. Next steps:`,
    )

    const nextSteps = [
      !ctx.args.shell &&
        relativeProjectPath.length > 1 &&
        `\`cd ${relativeProjectPath}\``,
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
