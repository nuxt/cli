import process from 'node:process'

import { defineCommand } from 'citty'

import { logger } from '../utils/logger'

import { resolveRootDir } from '../utils/paths'
import { logLevelArgs, rootDirArgs } from './_shared'

export default defineCommand({
  meta: {
    name: 'test',
    description: 'Run tests',
  },
  args: {
    ...rootDirArgs,
    ...logLevelArgs,
    dev: {
      type: 'boolean',
      description: 'Run in dev mode',
    },
    watch: {
      type: 'boolean',
      description: 'Watch mode',
    },
  },
  async run(ctx) {
    process.env.NODE_ENV = process.env.NODE_ENV || 'test'

    const cwd = resolveRootDir(ctx.args)

    const { runTests } = await importTestUtils()
    await runTests({
      rootDir: cwd,
      dev: ctx.args.dev,
      watch: ctx.args.watch,
      ...{},
    })
  },
})

async function importTestUtils(): Promise<typeof import('@nuxt/test-utils')> {
  let err
  for (const pkg of [
    '@nuxt/test-utils-nightly',
    '@nuxt/test-utils-edge',
    '@nuxt/test-utils',
  ]) {
    try {
      const exports = await import(pkg)
      // Detect old @nuxt/test-utils
      if (!exports.runTests) {
        throw new Error('Invalid version of `@nuxt/test-utils` is installed!')
      }
      return exports
    }
    catch (_err) {
      err = _err
    }
  }
  logger.error(String(err))
  throw new Error('`@nuxt/test-utils` seems missing. Run `npm i -D @nuxt/test-utils` or `yarn add -D @nuxt/test-utils` to install.')
}
