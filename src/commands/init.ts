import { writeFile } from 'node:fs/promises'
import { downloadTemplate, startShell } from 'giget'
import { relative } from 'pathe'
import { consola } from 'consola'
import { installDependencies } from 'nypm'
import type { PackageManagerName } from 'nypm'
import { defineNuxtCommand } from './index'

const DEFAULT_REGISTRY =
  'https://raw.githubusercontent.com/nuxt/starter/templates/templates'
const DEFAULT_TEMPLATE_NAME = 'v3'

export default defineNuxtCommand({
  meta: {
    name: 'init',
    usage:
      'npx nuxi init|create [--template,-t] [--force] [--offline] [--prefer-offline] [--shell] [dir]',
    description: 'Initialize a fresh project',
  },
  async invoke(args) {
    // Get template name
    const templateName = args.template || args.t || DEFAULT_TEMPLATE_NAME

    if (typeof templateName !== 'string') {
      consola.error('Please specify a template!')
      process.exit(1)
    }

    // Download template
    let t

    try {
      t = await downloadTemplate(templateName, {
        dir: args._[0] || '',
        force: Boolean(args.force),
        offline: Boolean(args.offline),
        preferOffline: Boolean(args['prefer-offline']),
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
      options: ['npm', 'pnpm', 'yarn'],
    })

    // Get relative project path
    const relativeProjectPath = relative(process.cwd(), t.dir)

    // Write .nuxtrc with `shamefully-hoist=true` for pnpm
    if (selectedPackageManager === 'pnpm') {
      await writeFile(`${relativeProjectPath}/.npmrc`, 'shamefully-hoist=true')
    }

    // Install project dependencies or skip installation based on '--offline' flag
    if (args.offline) {
      consola.info('Installing dependencies skipped in offline mode.')
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

    // Display next steps
    consola.log(
      `\n✨ Nuxt project has been created with the \`${t.name}\` template. Next steps:`
    )

    const nextSteps = [
      !args.shell &&
        relativeProjectPath.length > 1 &&
        `\`cd ${relativeProjectPath}\``,
      `Start development server with \`${
        selectedPackageManager === 'yarn'
          ? 'yarn'
          : `${selectedPackageManager} run`
      } dev\``,
    ].filter(Boolean)

    for (const step of nextSteps) {
      consola.log(` › ${step}`)
    }

    if (args.shell) {
      startShell(t.dir)
    }
  },
})
