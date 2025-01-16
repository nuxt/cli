import type { InputPluginOption } from 'rollup'
import { defineBuildConfig } from 'unbuild'
import { purgePolyfills } from 'unplugin-purge-polyfills'

export default defineBuildConfig({
  declaration: true,
  hooks: {
    'rollup:options': function (ctx, options) {
      const plugins = (options.plugins ||= []) as InputPluginOption[]
      plugins.push(purgePolyfills.rollup({ logLevel: 'verbose' }))
    },
  },
  rollup: {
    dts: {
      respectExternal: false,
    },
    inlineDependencies: true,
    resolve: {
      exportConditions: ['production', 'node'],
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
