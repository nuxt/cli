import type { InputPluginOption } from 'rollup'
import process from 'node:process'
import { visualizer } from 'rollup-plugin-visualizer'
import { defineBuildConfig } from 'unbuild'
import { purgePolyfills } from 'unplugin-purge-polyfills'

const isAnalysingSize = process.env.BUNDLE_SIZE === 'true'

export default defineBuildConfig({
  declaration: !isAnalysingSize,
  failOnWarn: !isAnalysingSize,
  rollup: {
    dts: {
      respectExternal: false,
    },
  },
  hooks: {
    'rollup:options': function (ctx, options) {
      const plugins = (options.plugins ||= []) as InputPluginOption[]
      plugins.push(purgePolyfills.rollup({ logLevel: 'verbose' }))
      if (isAnalysingSize) {
        plugins.unshift(visualizer({ template: 'raw-data' }))
      }
    },
  },
  entries: ['src/index', 'src/dev/index.ts'],
  externals: [
    '@nuxt/test-utils',
    '@nuxt/schema',
  ],
})
