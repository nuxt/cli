import { defineBuildConfig } from 'unbuild'
import type { InputPluginOption } from 'rollup'
import { purgePolyfills } from 'unplugin-purge-polyfills'

export default defineBuildConfig({
  declaration: true,
  hooks: {
    'rollup:options'(_, options) {
      const plugins = (options.plugins ||= []) as InputPluginOption[]
      plugins.push(purgePolyfills.rollup({
        logLevel: 'verbose'
      }))
    }
  },
  rollup: {
    inlineDependencies: true,
    resolve: {
      exportConditions: ['production', 'node'] as any,
    },
  },
  entries: ['src/index'],
  externals: [
    '@nuxt/test-utils',
    'fsevents',
    'node:url',
    'node:buffer',
    'node:path',
    'node:child_process',
    'node:process',
    'node:path',
    'node:os',
  ],
})
