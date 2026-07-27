import process from 'node:process'

// Node refs the IPC channel while a `message` listener is attached, which is
// what keeps this stand-in for a warm fork alive after it reports readiness.
process.on('message', () => {})
process.send({ type: 'nuxt:internal:dev:fork-ready' })
