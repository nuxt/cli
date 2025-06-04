import codspeed from '@codspeed/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [codspeed()],
  test: {
    coverage: {},
  },
})
