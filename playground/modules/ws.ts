import { WebSocketServer } from 'ws'
import { defineNuxtModule } from 'nuxt/kit'

// Note: This is an unofficial and unstable usage to add a WebSocket server to Nuxt.
// Please only use this file for testing purposes and avoid using it in real projects!
export default defineNuxtModule({
  setup(_, nuxt) {
    if (!nuxt.options.dev) {
      return
    }

    // https://github.com/websockets/ws
    const wss = new WebSocketServer({
      port: 8080,
    })

    wss.on('connection', (ws) => {
      ws.on('error', console.error)
      ws.on('message', (data) => {
        console.log('[wss] received: %s', data)
      })
      ws.send('🏓 pong')
    })

    wss.on('listening', () => {
      const port = (wss.address() as { port: number }).port
      console.log(`  ➜ WSS:      \`ws://localhost:${port}/ws\`\n`)
    })

    nuxt.hooks.hook('close', () => {
      wss.close()
    })

    nuxt.hook('listen', (server) => {
      server.on('upgrade', (req, socket, head) => {
        if (req.url === '/api/ws') {
          console.log(`[server] WebSocket upgrade for path: ${req.url}`)
          return wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit('connection', ws, req)
          })
        }
      })
    })
  },
})
