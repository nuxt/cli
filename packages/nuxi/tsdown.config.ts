import type { PackagingContract } from '../../scripts/tsdown.ts'
import { defineCliConfig, PARSER_PACKAGES, PARSER_SPECIFIERS } from '../../scripts/tsdown.ts'

export const packaging: PackagingContract = {
  external: PARSER_SPECIFIERS,
}

export default defineCliConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  shims: true,
  deps: { onlyBundle: false, neverBundle: PARSER_PACKAGES },
  dts: { entry: ['src/index.ts'] },
  // disabled due to upstream DTS warnings from @nuxt/schema type imports
  failOnWarn: false,
  ...packaging,
})
