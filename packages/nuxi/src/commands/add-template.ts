import { existsSync, promises as fsp } from 'node:fs'
import process from 'node:process'

import { cancel, intro, outro } from '@clack/prompts'
import { defineCommand } from 'citty'
import { colors } from 'consola/utils'
import { dirname, extname, resolve } from 'pathe'

import { loadKit } from '../utils/kit'
import { logger } from '../utils/logger'
import { relativeToProcess } from '../utils/paths'
import { templates } from '../utils/templates/index'
import { templateNames } from '../utils/templates/names'
import { cwdArgs, logLevelArgs } from './_shared'

async function loadNuxtConfigWithModules(cwd: string) {
  const kit = await loadKit(cwd)
  const nuxt = await kit.loadNuxt({ cwd, ready: false }).catch(() => null)

  if (!nuxt) {
    return { config: await kit.loadNuxtConfig({ cwd }) }
  }

  try {
    await nuxt.ready()
    await nuxt.hooks.callHook('templates:extend', templates)
  }
  catch {
    // module setup may fail; fall through with built-in templates only
  }
  finally {
    await nuxt.close()
  }

  return { config: nuxt.options }
}

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
    const { config } = await loadNuxtConfigWithModules(cwd)

    // Validate template name
    const template = templates[templateName]
    if (!template) {
      const templateNames = Object.keys(templates).map(name => colors.cyan(name))
      const lastTemplateName = templateNames.pop()
      logger.error(`Template ${colors.cyan(templateName)} is not supported.`)
      logger.info(`Possible values are ${templateNames.join(', ')} or ${lastTemplateName}.`)
      process.exit(1)
    }

    // Resolve template
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
