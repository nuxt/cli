// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  hooks: {
    async listen(server) {
      const { wss } = await import('./server/ws')
      server.on('upgrade', (req, socket, head) => {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req)
        })
      })
    },
  },
  nitro: {
    devProxy: {
      // TODO: Not working yet
      // '/api/ws': { target: 'ws://localhost:8080/ws', ws: true },
    },
  },
})
