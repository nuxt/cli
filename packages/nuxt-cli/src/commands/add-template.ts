import type { TemplateName } from '../utils/templates/names'

import { promises as fsp } from 'node:fs'
import process from 'node:process'
import { styleText } from 'node:util'

import { intro, outro } from '@clack/prompts'
import { defineCommand } from 'citty'
import { dirname, extname, resolve } from 'pathe'

import { loadKit } from '../utils/kit'
import { logger } from '../utils/logger'
import { relativeToProcess } from '../utils/paths'
import { templates } from '../utils/templates/index'
import { templateNames } from '../utils/templates/names'
import { cwdArgs, logLevelArgs } from './_shared'

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
      description: 'Overwrite the file if it already exists',
      default: false,
    },
    mode: {
      type: 'string',
      valueHint: 'client|server',
      description: 'Add a client or server suffix to a component or plugin',
    },
    method: {
      type: 'string',
      valueHint: 'connect|delete|get|head|options|patch|post|put|trace',
      description: 'Add an HTTP method suffix to an API route',
    },
    global: {
      type: 'boolean',
      description: 'Create global route middleware',
    },
    api: {
      type: 'boolean',
      description: 'Create a server route in the API directory',
    },
    pages: {
      type: 'boolean',
      description: 'Include NuxtPage and NuxtLayout in the app template',
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

    intro(styleText('cyan', 'Adding template...'))

    const templateName = ctx.args.template as TemplateName

    if (!templateNames.includes(templateName)) {
      const supported = templateNames.map(name => styleText('cyan', name))
      const last = supported.pop()
      logger.error(`Template ${styleText('cyan', templateName)} is not supported.`)
      logger.info(`Possible values are ${supported.join(', ')} or ${last}.`)
      process.exit(1)
    }

    if (ctx.args.mode && ctx.args.mode !== 'client' && ctx.args.mode !== 'server') {
      logger.error(`Mode must be ${styleText('cyan', 'client')} or ${styleText('cyan', 'server')}.`)
      process.exit(1)
    }
    if (ctx.args.method && !['connect', 'delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'trace'].includes(ctx.args.method)) {
      logger.error(`HTTP method ${styleText('cyan', ctx.args.method)} is not supported.`)
      process.exit(1)
    }

    const ext = ['.vue', '.ts'].find(ext => ctx.args.name.endsWith(ext))
    const name = ext
      ? ctx.args.name.slice(0, -ext.length)
      : ctx.args.name

    if (!name) {
      logger.error('Template name must not be empty.')
      process.exit(1)
    }

    const kit = await loadKit(cwd)
    const config = await kit.loadNuxtConfig({ cwd })
    const res = templates[templateName]({ name, args: ctx.args, nuxtOptions: config })
    const stubPath = resolve(config.rootDir, 'stubs', `${templateName}${extname(res.path)}`)
    try {
      res.contents = await fsp.readFile(stubPath, 'utf8')
    }
    catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        throw error
      }
    }
    const parentDir = dirname(res.path)
    const createdDir = await fsp.mkdir(parentDir, { recursive: true })
    if (createdDir) {
      logger.step(`Created directory ${styleText('cyan', relativeToProcess(parentDir))}.`)
      if (templateName === 'page') {
        logger.info('This enables vue-router functionality!')
      }
    }

    try {
      await fsp.writeFile(res.path, `${res.contents.trim()}\n`, { flag: ctx.args.force ? 'w' : 'wx' })
    }
    catch (error) {
      if (!ctx.args.force && (error as NodeJS.ErrnoException).code === 'EEXIST') {
        logger.error(`File exists at ${styleText('cyan', relativeToProcess(res.path))}.`)
        logger.info(`Use ${styleText('cyan', '--force')} to overwrite it or use a different name.`)
        process.exit(1)
      }
      throw error
    }
    logger.success(`Created ${styleText('cyan', relativeToProcess(res.path))}.`)
    outro(`Generated a new ${styleText('cyan', templateName)}!`)
  },
})
