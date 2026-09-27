import inspector from 'node:inspector'
import { createServer } from 'node:net'
import process from 'node:process'
import { isMainThread } from 'node:worker_threads'

/** Open the inspector in the Nitro dev worker once the previous worker releases the port. */
export default function () {
  const target = process.env.__NUXT_DEV_INSPECT__
  if (isMainThread || !target || inspector.url()) {
    return
  }
  const { host, port } = JSON.parse(target)
  const deadline = Date.now() + 10_000
  const retry = () => {
    if (Date.now() < deadline) {
      setTimeout(attempt, 100).unref()
    }
  }
  const open = () => {
    try {
      inspector.open(port, host, false)
    }
    catch {}
    if (!inspector.url()) {
      retry()
    }
  }
  function attempt() {
    if (port === 0) {
      return open()
    }
    const probe = createServer()
    probe.unref()
    probe.once('error', (error) => {
      if (error?.code === 'EADDRINUSE') {
        return retry()
      }
      process.stderr.write(`Could not start the inspector on ${host}:${port}: ${error?.message ?? error}\n`)
    })
    probe.listen(port, host, () => probe.close(open))
  }
  attempt()
}
