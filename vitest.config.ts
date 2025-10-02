import codspeed from '@codspeed/vitest-plugin'
import { isCI, isWindows } from 'std-env'
import { defaultExclude, defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: isCI && !isWindows ? [codspeed()] : [],
  test: {
    coverage: {},
    exclude: [
      ...defaultExclude,
      'playground/**',
    ],
  },
})
