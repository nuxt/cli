import { existsSync, promises as fsp } from 'node:fs'
import process from 'node:process'

import { cancel, intro, outro } from '@clack/prompts'
import { defineCommand } from 'citty'
import { colors } from 'consola/utils'
import { dirname, extname, resolve } from 'pathe'

import { loadKit } from '../utils/kit'
import { logger } from '../utils/logger'
import { relativeToProcess } from '../utils/paths'
import { templates } from '../utils/templates'
import { cwdArgs, logLevelArgs } from './_shared'

const templateNames = Object.keys(templates)

export default defineCommand({
  meta: {
    name: 'add',
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
    template: {
      type: 'positional',
      required: true,
      valueHint: templateNames.join('|'),
      description: `Specify which template to generate`,
    },
    name: {
      type: 'positional',
      required: true,
      description: 'Specify name of the generated file',
    },
  },
  async run(ctx) {
    const cwd = resolve(ctx.args.cwd)

    intro(colors.cyan('Adding template...'))

    const templateName = ctx.args.template

    // Validate template name
    if (!templateNames.includes(templateName)) {
      const templateNames = Object.keys(templates).map(name => colors.cyan(name))
      const lastTemplateName = templateNames.pop()
      logger.error(`Template ${colors.cyan(templateName)} is not supported.`)
      logger.info(`Possible values are ${templateNames.join(', ')} or ${lastTemplateName}.`)
      process.exit(1)
    }

    // Validate options
    const ext = extname(ctx.args.name)
    const name
      = ext === '.vue' || ext === '.ts'
        ? ctx.args.name.replace(ext, '')
        : ctx.args.name

    if (!name) {
      cancel('name argument is missing!')
      process.exit(1)
    }

    // Load config in order to respect srcDir
    const kit = await loadKit(cwd)
    const config = await kit.loadNuxtConfig({ cwd })

    // Resolve template
    const template = templates[templateName as keyof typeof templates]

    const res = template({ name, args: ctx.args, nuxtOptions: config })

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
  },
})
