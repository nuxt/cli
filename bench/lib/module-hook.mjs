import module from 'node:module'
import process from 'node:process'

const loaded = new Map()

module.registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context)
    if (!loaded.has(url)) {
      const source = result.source
      const bytes = typeof source === 'string' ? Buffer.byteLength(source) : source ? source.byteLength : 0
      loaded.set(url, bytes)
    }
    return result
  },
})

process.on('exit', () => {
  let bytes = 0
  let nodeModules = 0
  for (const [url, size] of loaded) {
    bytes += size
    if (url.includes('/node_modules/')) {
      nodeModules++
    }
  }
  // `_rawDebug` writes straight to fd 2 and cannot be intercepted by the CLI's own logging
  process._rawDebug(`__BENCH_MODULES__${JSON.stringify({ modules: loaded.size, nodeModules, bytes })}`)
})
