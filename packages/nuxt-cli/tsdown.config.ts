import type { PackagingContract } from '../../scripts/tsdown.ts'
import { defineCliConfig, PARSER_PACKAGES, PARSER_SPECIFIERS } from '../../scripts/tsdown.ts'

export const packaging: PackagingContract = {
  external: PARSER_SPECIFIERS,
  lazy: {
    'dist/index.mjs': ['rc9'],
    'dist/dev/index.mjs': ['rc9', 'my-bad', 'my-bad/channel', 'my-bad/presets', 'my-bad/sinks'],
  },
}

export default defineCliConfig({
  entry: ['src/index.ts', 'src/dev/index.ts'],
  deps: { onlyBundle: ['@bomb.sh/tab', 'citty', 'h3', 'nypm', '@speed-highlight/core'], neverBundle: PARSER_PACKAGES },
  ...packaging,
})
