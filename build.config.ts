import process from 'node:process'
import { defineBuildConfig } from 'unbuild'
import type { InputPluginOption } from 'rollup'
import { purgePolyfills } from 'unplugin-purge-polyfills'
import { visualizer } from 'rollup-plugin-visualizer'

const isAnalysingSize = process.env.BUNDLE_SIZE === 'true'

export default defineBuildConfig({
  declaration: !isAnalysingSize,
  hooks: {
    'rollup:options'(_, options) {
      const plugins = (options.plugins ||= []) as InputPluginOption[]
      plugins.push(purgePolyfills.rollup({
        logLevel: 'verbose',
      }))
      if (isAnalysingSize) {
        plugins.unshift(visualizer({ template: 'raw-data' }))
      }
    },
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
