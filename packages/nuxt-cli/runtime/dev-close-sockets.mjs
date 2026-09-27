import { subscribe, unsubscribe } from 'node:diagnostics_channel'

/**
 * Destroy sockets left open in the Nitro dev worker on shutdown, including
 * upgraded ones that `server.closeAllConnections()` skips.
 *
 * TODO: remove once https://github.com/nitrojs/nitro/pull/4671 is released.
 */
export default function (nitroApp) {
  const sockets = new Set()
  const track = ({ socket }) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  }
  subscribe('net.server.socket', track)
  nitroApp.hooks.hook('close', () => {
    unsubscribe('net.server.socket', track)
    for (const socket of sockets) {
      socket.destroy()
    }
  })
}
