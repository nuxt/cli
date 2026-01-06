import { existsSync, promises as fsp } from 'node:fs'
import process from 'node:process'

import { cancel, intro, outro } from '@clack/prompts'
import { defineCommand } from 'citty'
import { colors } from 'consola/utils'
import { dirname, extname, resolve } from 'pathe'

import { runCommand } from '../run'
import { loadKit } from '../utils/kit'
import { logger } from '../utils/logger'
import { relativeToProcess } from '../utils/paths'
import { templateNames, templates } from '../utils/templates/index'
import { cwdArgs, logLevelArgs } from './_shared'
import addModuleCommand from './module/add'

export default defineCommand({
  meta: {
    name: 'add-template',
    description: 'Create a new template file.',
  },
  args: {
    ...cwdArgs,
    ...logLevelArgs,
    force: {
      type: 'boolean',
      description: 'Force override file if it already exists',
      default: false,
    },
    template_or_module: {
      type: 'positional',
      required: false,
      valueHint: `Templates: ${templateNames.join('|')}`,
      description: `Specify which template to generate or module to install`,
    },
    name: {
      type: 'positional',
      required: false,
      description: 'Specify name of the generated file (required for templates)',
    },
    skipInstall: {
      type: 'boolean',
      description: 'Skip npm install (for module installation)',
    },
    skipConfig: {
      type: 'boolean',
      description: 'Skip nuxt.config.ts update (for module installation)',
    },
    dev: {
      type: 'boolean',
      description: 'Install modules as dev dependencies (for module installation)',
    },
  },
  async run(ctx) {
    const cwd = resolve(ctx.args.cwd)

    const templateName = ctx.args.template_or_module
    const name = ctx.args.name

    // Detect mode: template mode if first arg is a template name AND second arg exists
    const isTemplateMode = templateName && templateNames.includes(templateName) && name

    if (isTemplateMode) {
      // Template scaffolding mode (existing behavior for backwards compatibility)
      intro(colors.cyan('Adding template...'))

      // Validate options
      const ext = extname(name)
      const sanitizedName
        = ext === '.vue' || ext === '.ts'
          ? name.replace(ext, '')
          : name

      if (!sanitizedName) {
        cancel('name argument is missing!')
        process.exit(1)
      }

      // Load config in order to respect srcDir
      const kit = await loadKit(cwd)
      const config = await kit.loadNuxtConfig({ cwd })

      // Resolve template
      const template = templates[templateName as keyof typeof templates]

      const res = template({ name: sanitizedName, args: ctx.args, nuxtOptions: config })

      // Ensure not overriding user code
      if (!ctx.args.force && existsSync(res.path)) {
        logger.error(`File exists at ${colors.cyan(relativeToProcess(res.path))}.`)
        logger.info(`Use ${colors.cyan('--force')} to override or use a different name.`)
        process.exit(1)
      }

      // Ensure parent directory exists
      const parentDir = dirname(res.path)
      if (!existsSync(parentDir)) {
        logger.step(`Creating directory ${colors.cyan(relativeToProcess(parentDir))}.`)
        if (templateName === 'page') {
          logger.info('This enables vue-router functionality!')
        }
        await fsp.mkdir(parentDir, { recursive: true })
      }

      // Write file
      await fsp.writeFile(res.path, `${res.contents.trim()}\n`)
      logger.success(`Created ${colors.cyan(relativeToProcess(res.path))}.`)
      outro(`Generated a new ${colors.cyan(templateName)}!`)
    }
    else {
      const modulesToAdd = ctx.args._.map(e => e.trim()).filter(Boolean)
      const args: string[] = [
        ...modulesToAdd,
        `--cwd=${cwd}`,
        ctx.args.skipInstall ? '--skipInstall' : '',
        ctx.args.skipConfig ? '--skipConfig' : '',
        ctx.args.dev ? '--dev' : '',
        ctx.args.logLevel ? `--logLevel=${ctx.args.logLevel}` : '',
      ].filter(Boolean)
      await runCommand(addModuleCommand, args)
    }
  },
})
