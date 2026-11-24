#!/usr/bin/env node

import nodeModule from 'node:module'
import { homedir } from 'node:os'
import { join, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// rolldown/oxc link mimalloc, whose eager 1GiB arenas inflate RSS on Linux.
// mimalloc reads this once, when the first addon linking it loads, so keep it above all imports.
process.env.MIMALLOC_ARENA_EAGER_COMMIT ||= '0'

// https://nodejs.org/api/module.html#moduleenablecompilecachecachedir
// https://github.com/nodejs/node/pull/54501
const entry = fileURLToPath(import.meta.url)
if (nodeModule.enableCompileCache && !process.env.NODE_DISABLE_COMPILE_CACHE) {
  // handle `<tmpdir>/node-compile-cache` if owned by another user
  const candidates = [
    [undefined],
    [
      join(homedir(), '.cache', 'nuxt', 'compile-cache'),
    ],
  ]
  // prefer the outermost `node_modules` holding this file, which CI build caches commonly persist
  const modulesDirEnd = entry.indexOf(`${sep}node_modules${sep}`)
  if (modulesDirEnd !== -1 && !process.env.NODE_COMPILE_CACHE) {
    candidates.unshift([
      join(entry.slice(0, modulesDirEnd + 1), 'node_modules', '.cache', 'nuxt', 'compile-cache'),
      // keys entries relative to the cache, so a checkout at another path still hits (Node 24.12+)
      !process.env.NODE_COMPILE_CACHE_PORTABLE,
    ])
  }
  for (const [candidate, portable] of candidates) {
    if (portable) {
      process.env.NODE_COMPILE_CACHE_PORTABLE = '1'
    }
    let directory
    try {
      ({ directory } = nodeModule.enableCompileCache(candidate))
    }
    catch {}
    if (directory) {
      // allow child processes to share the same cache directory
      process.env.NODE_COMPILE_CACHE ||= directory
      break
    }
    if (portable) {
      delete process.env.NODE_COMPILE_CACHE_PORTABLE
    }
  }
}

globalThis.__nuxt_cli__ = {
  startTime: Date.now(),
  entry,
  devEntry: fileURLToPath(new URL('../dist/dev/index.mjs', import.meta.url)),
}

if (
  process.argv.includes('--profile')
  || process.argv.some(a => a.startsWith('--profile='))
) {
  const session = new (process.getBuiltinModule('node:inspector').Session)()
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

// Only `dev` has anything to show before the command graph loads.
if (process.argv[2] === 'dev') {
  // Without the panel the command still runs, so a failure here is not fatal.
  // eslint-disable-next-line antfu/no-top-level-await
  await import('../dist/boot.mjs').then(({ bootDevUI }) => bootDevUI()).catch(() => {})
}

// eslint-disable-next-line antfu/no-top-level-await
const { runMain } = await import('../dist/index.mjs')

runMain()
