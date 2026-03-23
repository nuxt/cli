import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Prevent `@nuxt/test-utils` setup() in separate files from racing on the same random port.
    fileParallelism: false,
  },
})
