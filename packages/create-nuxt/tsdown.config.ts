import type { PackagingContract } from '../../scripts/tsdown.ts'
import { defineCliConfig } from '../../scripts/tsdown.ts'

export const packaging: PackagingContract = {}

export default defineCliConfig({
  entry: ['src/index.ts'],
  deps: { onlyBundle: false },
  ...packaging,
})
