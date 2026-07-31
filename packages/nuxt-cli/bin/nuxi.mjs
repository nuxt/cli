#!/usr/bin/env node

import inspector from 'node:inspector'
import nodeModule from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// rolldown/oxc link mimalloc, whose eager 1GiB arenas inflate RSS on Linux.
// mimalloc reads this once, when the first addon linking it loads, so keep it above all imports.
process.env.MIMALLOC_ARENA_EAGER_COMMIT ||= '0'

// https://nodejs.org/api/module.html#moduleenablecompilecachecachedir
// https://github.com/nodejs/node/pull/54501
//
// handle `<tmpdir>/node-compile-cache` if owned by another user
if (nodeModule.enableCompileCache && !process.env.NODE_DISABLE_COMPILE_CACHE) {
  for (const candidate of [undefined, join(homedir(), '.cache', 'nuxt', 'compile-cache')]) {
    let directory
    try {
      ({ directory } = nodeModule.enableCompileCache(candidate))
    }
    catch {
      continue
    }
    if (directory) {
      // allow child processes to share the same cache directory
      process.env.NODE_COMPILE_CACHE ||= directory
      break
    }
  }
}

globalThis.__nuxt_cli__ = {
  startTime: Date.now(),
  entry: fileURLToPath(import.meta.url),
  devEntry: fileURLToPath(new URL('../dist/dev/index.mjs', import.meta.url)),
}

if (
  process.argv.includes('--profile')
  || process.argv.some(a => a.startsWith('--profile='))
) {
  const session = new inspector.Session()
  session.connect()

  try {
    // eslint-disable-next-line antfu/no-top-level-await
    await new Promise((resolve, reject) => {
      session.post('Profiler.enable', (err) => {
        if (err) {
          return reject(err)
        }
        session.post('Profiler.start', (err) => {
          if (err) {
            return reject(err)
          }
          resolve()
        })
      })
    })
    globalThis.__nuxt_cli__.cpuProfileSession = session
  }
  catch (err) {
    session.disconnect()
    throw err
  }
}

// eslint-disable-next-line antfu/no-top-level-await
const { runMain } = await import('../dist/index.mjs')

runMain()
