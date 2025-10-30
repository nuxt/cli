import type { UserConfig } from 'tsdown'
import process from 'node:process'
import { visualizer } from 'rollup-plugin-visualizer'
import { defineConfig } from 'tsdown'
import { purgePolyfills } from 'unplugin-purge-polyfills'
import { generateCompletionData } from '../../scripts/generate-completions-data'

const isAnalysingSize = process.env.BUNDLE_SIZE === 'true'

export default defineConfig({
  entry: ['src/index.ts', 'src/dev/index.ts'],
  fixedExtension: true,
  dts: !isAnalysingSize && {
    oxc: true,
  },
  hooks: {
    'build:prepare': async function () {
      await generateCompletionData()
    },
  },
  failOnWarn: !isAnalysingSize,
  plugins: [
    purgePolyfills.rolldown({ logLevel: 'verbose' }),
    ...(isAnalysingSize ? [visualizer({ template: 'raw-data' })] : []),
  ],
}) satisfies UserConfig as UserConfig
