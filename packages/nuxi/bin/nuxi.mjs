#!/usr/bin/env node

import inspector from 'node:inspector'
import nodeModule from 'node:module'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// https://nodejs.org/api/module.html#moduleenablecompilecachecachedir
// https://github.com/nodejs/node/pull/54501
if (nodeModule.enableCompileCache && !process.env.NODE_DISABLE_COMPILE_CACHE) {
  try {
    const { directory } = nodeModule.enableCompileCache()
    if (directory) {
      // allow child process to share the same cache directory
      process.env.NODE_COMPILE_CACHE ||= directory
    }
  }
  catch {
    // Ignore errors
  }
}

globalThis.__nuxt_cli__ = {
  startTime: Date.now(),
  entry: fileURLToPath(import.meta.url),
  devEntry: fileURLToPath(new URL('../dist/dev/index.mjs', import.meta.url)),
  cpuProfileSession: undefined,
}

if (
  process.argv.includes('--profile')
  || process.argv.some(a => a.startsWith('--profile='))
) {
  const session = new inspector.Session()
  session.connect()
  // eslint-disable-next-line antfu/no-top-level-await
  await new Promise((resolve) => {
    session.post('Profiler.enable', () => {
      session.post('Profiler.start', resolve)
    })
  })
  globalThis.__nuxt_cli__.cpuProfileSession = session
}

// eslint-disable-next-line antfu/no-top-level-await
const { runMain } = await import('../dist/index.mjs')

runMain()
