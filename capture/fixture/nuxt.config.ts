export default defineNuxtConfig({
  compatibilityDate: '2024-09-05',
  nitro: {
    experimental: {
      tasks: true,
    },
  },
  vite: {
    // Pre-bundled so Vite never discovers it while serving the first request:
    // whether it does depends on timing, and its hint would flip the captures.
    optimizeDeps: {
      include: ['@vue/devtools-core'],
    },
  },
})
