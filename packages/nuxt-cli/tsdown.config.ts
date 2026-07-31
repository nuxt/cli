import type { PackagingContract } from '../../scripts/tsdown.ts'
import { defineCliConfig, PARSER_PACKAGES, PARSER_SPECIFIERS } from '../../scripts/tsdown.ts'

export const packaging: PackagingContract = {
  traced: ['youch', 'youch-core'],
  external: PARSER_SPECIFIERS,
  lazy: {
    'dist/index.mjs': ['rc9'],
    'dist/dev/index.mjs': ['youch', 'youch-core', 'source-map-js', 'rc9'],
  },
}

export default defineCliConfig({
  entry: ['src/index.ts', 'src/dev/index.ts'],
  // h3 is inlined as we have two different versions (+ rou3 is a transitive dep of h3-next)
  deps: { onlyBundle: ['h3', 'rou3'], neverBundle: PARSER_PACKAGES },
  ...packaging,
})
