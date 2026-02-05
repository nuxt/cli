import type { UserConfig } from 'tsdown'
import process from 'node:process'
import { visualizer } from 'rollup-plugin-visualizer'
import { defineConfig } from 'tsdown'
import { purgePolyfills } from 'unplugin-purge-polyfills'

const isAnalysingSize = process.env.BUNDLE_SIZE === 'true'

export default defineConfig({
  entry: ['src/index.ts', 'src/dev/index.ts'],
  fixedExtension: true,
  // h3 is inlined as we have two different versions (+ rou3 is a transitive dep of h3-next)
  inlineOnly: ['h3', 'rou3'],
  dts: !isAnalysingSize && {
    oxc: true,
  },
  failOnWarn: !isAnalysingSize,
  plugins: [
    purgePolyfills.rolldown({ logLevel: 'verbose' }),
    ...(isAnalysingSize ? [visualizer({ template: 'raw-data' })] : []),
  ],
}) satisfies UserConfig as UserConfig
