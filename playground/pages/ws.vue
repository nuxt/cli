<script setup lang="ts">
import { WebSocket } from 'unws'

const reqURL = useRequestURL()
const isSecure = reqURL.protocol === 'https:'
const urls = [
  `${isSecure ? 'wss' : 'ws'}://${reqURL.host}/api/ws`,
  'ws://localhost:8080',
]
const _queryURL = useRoute().query.url as string
if (_queryURL && !urls.includes(_queryURL)) {
  urls.push(_queryURL)
}

// Poor man logger
const logs = ref<string[]>([])
let lastTime = Date.now()
const log = (message: string) => {
  console.log(message)
  const now = Date.now()
  const timeTaken = now - lastTime
  logs.value.push(`${message} ${timeTaken > 0 ? `(+${timeTaken}ms)` : ''}`)
  lastTime = now
}

const wsAddress = ref<string>((useRoute().query.url as string) || urls[0])

if (process.client) {
  const init = () => {
    logs.value = []

    // Create WebSocket connection.
    log(`Creating WebSocket connection to ${wsAddress.value}...`)
    const socket = new WebSocket(wsAddress.value)

    // Connection opened
    socket.addEventListener('open', () => {
      log('WebSocket connection opened!')
      log('Sending ping...')
      socket.send('ping from client')
    })

    // Listen for messages
    socket.addEventListener('message', (event) => {
      log(`Message from server: ${JSON.stringify(event.data)}`)
    })
  }
  onMounted(() => init())
  watch(wsAddress, () => {
    const u = new URL(window.location.href)
    u.searchParams.set('url', wsAddress.value)
    history.pushState({}, '', u)
    init()
  })
}
</script>

<template>
  <div>
    <h1>WebSocket Playground</h1>
    <select v-model="wsAddress">
      <option
        v-for="url in urls"
        :key="url"
        :value="url"
        :selected="url === wsAddress"
      >
        {{ url }}
      </option>
    </select>
    <h2>Logs</h2>
    <pre><code>{{ logs.join('\n') }}</code></pre>
  </div>
</template>
