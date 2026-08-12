import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { defineCommand } from 'citty'
import { resolveModulePath } from 'exsolve'

import { ActionableError } from '../utils/errors'
import { resolveRootDir } from '../utils/paths'
import { rootDirArgs } from './_shared'

export default defineCommand({
  meta: {
    name: 'test',
    description: 'Run tests',
  },
  args: {
    ...rootDirArgs,
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

    const { runTests } = await importTestUtils(cwd)
    await runTests({
      rootDir: cwd,
      dev: ctx.args.dev,
      watch: ctx.args.watch,
    })
  },
})

export async function importTestUtils(rootDir: string): Promise<typeof import('@nuxt/test-utils')> {
  for (const pkg of ['@nuxt/test-utils-nightly', '@nuxt/test-utils-edge', '@nuxt/test-utils']) {
    const entry = resolveModulePath(pkg, { from: rootDir, try: true })
    if (!entry) {
      continue
    }

    const exports = await import(pathToFileURL(entry).href)
    if (typeof exports.runTests !== 'function') {
      throw new ActionableError(`The installed version of \`${pkg}\` does not support \`nuxt test\`.`)
    }
    return exports
  }

  throw new ActionableError('`@nuxt/test-utils` is not installed in this project. Install it as a development dependency to use `nuxt test`.')
}
