// Loaded into a recorded CLI via `NODE_OPTIONS=--import ...` to answer live
// API requests from committed fixture data, so re-recordings do not pick up
// registry drift (star counts, new modules, reordered results).
//
// CAPTURE_FETCH_STUBS is a JSON object mapping a URL prefix to the absolute
// path of a JSON file served as the response body.

import { readFileSync } from 'node:fs'

const stubs = Object.entries(JSON.parse(process.env.CAPTURE_FETCH_STUBS ?? '{}'))
const realFetch = globalThis.fetch

globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url ?? String(input)
  for (const [prefix, file] of stubs) {
    if (url.startsWith(prefix)) {
      return new Response(readFileSync(file, 'utf8'), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
  }
  return realFetch(input, init)
}
