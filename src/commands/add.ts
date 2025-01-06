import { existsSync, promises as fsp } from 'node:fs'
import { dirname, resolve, extname } from 'pathe'
import { defineCommand } from 'citty'

import { logger } from '../utils/logger'
import { loadKit } from '../utils/kit'
import { templates } from '../utils/templates'
import { cwdArgs, logLevelArgs } from './_shared'

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
      description: 'Override existing file',
    },
    template: {
      type: 'positional',
      required: true,
      valueHint: Object.keys(templates).join('|'),
      description: `Template type to scaffold`,
    },
    name: {
      type: 'positional',
      required: true,
      description: 'Generated file name',
    },
  },
  async run(ctx) {
    const cwd = resolve(ctx.args.cwd)

    const templateName = ctx.args.template
    const template = templates[templateName]
    const ext = extname(ctx.args.name)
    const name
      = ext === '.vue' || ext === '.ts'
        ? ctx.args.name.replace(ext, '')
        : ctx.args.name

    // Validate template name
    if (!template) {
      logger.error(
        `Template ${templateName} is not supported. Possible values: ${Object.keys(
          templates,
        ).join(', ')}`,
      )
      process.exit(1)
    }

    // Validate options
    if (!name) {
      logger.error('name argument is missing!')
      process.exit(1)
    }

    // Load config in order to respect srcDir
    const kit = await loadKit(cwd)
    const config = await kit.loadNuxtConfig({ cwd })

    // Resolve template
    const res = template({ name, args: ctx.args, nuxtOptions: config })

    // Ensure not overriding user code
    if (!ctx.args.force && existsSync(res.path)) {
      logger.error(
        `File exists: ${res.path} . Use --force to override or use a different name.`,
      )
      process.exit(1)
    }

    // Ensure parent directory exists
    const parentDir = dirname(res.path)
    if (!existsSync(parentDir)) {
      logger.info('Creating directory', parentDir)
      if (templateName === 'page') {
        logger.info('This enables vue-router functionality!')
      }
      await fsp.mkdir(parentDir, { recursive: true })
    }

    // Write file
    await fsp.writeFile(res.path, res.contents.trim() + '\n')
    logger.info(`🪄 Generated a new ${templateName} in ${res.path}`)
  },
})
