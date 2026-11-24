import nodeModule from 'node:module'
import process from 'node:process'

process.on('exit', () => {
  process._rawDebug(`CACHEDIR=${nodeModule.getCompileCacheDir() ?? 'none'}`)
  process._rawDebug(`PORTABLE=${process.env.NODE_COMPILE_CACHE_PORTABLE ?? 'unset'}`)
})
