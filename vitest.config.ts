import codspeed from '@codspeed/vitest-plugin'
import { defaultExclude, defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [codspeed()],
  test: {
    coverage: {},
    exclude: [
      ...defaultExclude,
      'playground/**',
    ],
  },
})
