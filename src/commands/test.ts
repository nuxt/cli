import { resolve } from 'pathe'
import { defineNuxtCommand } from './index'

export default defineNuxtCommand({
  meta: {
    name: 'test',
    description: 'Run tests',
  },
  args: {
    rootDir: {
      type: 'positional',
      description: 'Root directory of your Nuxt app',
    },
    dev: {
      type: 'boolean',
      description: 'Run tests in dev mode',
    },
    watch: {
      type: 'boolean',
      description: 'Watch for changes and re-run tests',
    },
  },
  async run({ args }) {
    process.env.NODE_ENV = process.env.NODE_ENV || 'test'
    const rootDir = resolve(args._[0] || '.')
    const { runTests } = await importTestUtils()
    await runTests({
      rootDir,
      dev: !!args.dev,
      watch: !!args.watch,
    })

    if (args.watch) {
      return 'wait' as const
    }
  },
})

async function importTestUtils(): Promise</*typeof import('@nuxt/test-utils')*/ any> {
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
    '`@nuxt/test-utils-edge` seems missing. Run `npm i -D @nuxt/test-utils-edge` or `yarn add -D @nuxt/test-utils-edge` to install.'
  )
}
