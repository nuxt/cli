import { WebSocketServer } from 'ws'

// https://github.com/websockets/ws

export const wss = new WebSocketServer({
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
