import type { InputPluginOption } from 'rollup'
import process from 'node:process'
import { visualizer } from 'rollup-plugin-visualizer'
import { defineBuildConfig } from 'unbuild'
import { purgePolyfills } from 'unplugin-purge-polyfills'

const isAnalysingSize = process.env.BUNDLE_SIZE === 'true'

export default defineBuildConfig({
  declaration: !isAnalysingSize,
  failOnWarn: !isAnalysingSize,
  hooks: {
    'rollup:options': function (ctx, options) {
      const plugins = (options.plugins ||= []) as InputPluginOption[]
      plugins.push(purgePolyfills.rollup({ logLevel: 'verbose' }))
      if (isAnalysingSize) {
        plugins.unshift(visualizer({ template: 'raw-data' }))
      }
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
    'youch',
  ],
})
