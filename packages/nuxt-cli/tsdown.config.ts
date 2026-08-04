import type { PackagingContract } from '../../scripts/tsdown.ts'
import { defineCliConfig, PARSER_PACKAGES, PARSER_SPECIFIERS } from '../../scripts/tsdown.ts'

export const packaging: PackagingContract = {
  traced: ['youch', 'youch-core'],
  external: PARSER_SPECIFIERS,
  lazy: {
    'dist/index.mjs': ['rc9'],
    'dist/dev/index.mjs': ['youch', 'youch-core', 'rc9'],
  },
}

export default defineCliConfig({
  entry: ['src/index.ts', 'src/dev/index.ts'],
  deps: { onlyBundle: ['h3'], neverBundle: PARSER_PACKAGES },
  ...packaging,
})
