import { resolve } from 'pathe'
import { defineCommand } from 'citty'

import { legacyRootDirArgs, sharedArgs } from './_shared'

export default defineCommand({
  meta: {
    name: 'test',
    description: 'Run tests',
  },
  args: {
    ...sharedArgs,
    ...legacyRootDirArgs,
    cwd: {
      type: 'string',
      description: 'Current working directory',
    },
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

    const cwd = resolve(ctx.args.cwd || ctx.args.rootDir || '.')

    const { runTests } = await importTestUtils()
    await runTests({
      cwd,
      dev: ctx.args.dev,
      watch: ctx.args.watch,
      .../*ctx.options ||*/ {},
    })
  },
})

// @ts-ignore TODO
async function importTestUtils(): Promise<typeof import('@nuxt/test-utils')> {
  let err
  for (const pkg of ['@nuxt/test-utils-edge', '@nuxt/test-utils']) {
    try {
      const exports = await import(pkg)
      // Detect old @nuxt/test-utils
      if (!exports.runTests) {
        throw new Error('Invalid version of `@nuxt/test-utils` is installed!')
      }
      return exports
    } catch (_err) {
      err = _err
    }
  }
  console.error(err)
  throw new Error(
    '`@nuxt/test-utils-edge` seems missing. Run `npm i -D @nuxt/test-utils-edge` or `yarn add -D @nuxt/test-utils-edge` to install.',
  )
}
