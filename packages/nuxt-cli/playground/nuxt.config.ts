// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2024-09-05',
  nitro: {
    experimental: {
      websocket: true,
    },
  },
})
