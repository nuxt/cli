import nodeModule from 'node:module'
import process from 'node:process'

process.on('exit', () => {
  process._rawDebug(`CACHEDIR=${nodeModule.getCompileCacheDir() ?? 'none'}`)
})
