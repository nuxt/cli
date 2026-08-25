// Loaded into a recorded CLI via `NODE_OPTIONS=--import ...` to answer live
// API requests from committed fixture data, so re-recordings do not pick up
// registry drift (star counts, new modules, reordered results).
//
// CAPTURE_FETCH_STUBS is a JSON object mapping a URL prefix to the absolute
// path of a JSON file served as the response body.
//
// CAPTURE_FETCH_LATENCY is a floor, in milliseconds, on how long every request
// takes. A prompt spinner is only ever drawn from its 80ms repaint timer, so a
// request that resolves sooner than that leaves no trace in the recording at
// all: the floor keeps the spinner on screen whatever the link is doing.

import { readFileSync } from 'node:fs'

const stubs = Object.entries(JSON.parse(process.env.CAPTURE_FETCH_STUBS ?? '{}'))
const latency = Number(process.env.CAPTURE_FETCH_LATENCY ?? 0)
const realFetch = globalThis.fetch

globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url ?? String(input)
  const settled = latency > 0 ? new Promise(resolve => setTimeout(resolve, latency)) : undefined
  for (const [prefix, file] of stubs) {
    if (url.startsWith(prefix)) {
      const body = readFileSync(file, 'utf8')
      await settled
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
  }
  const response = await realFetch(input, init)
  await settled
  return response
}
