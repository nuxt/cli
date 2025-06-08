#!/usr/bin/env node

import nodeModule from 'node:module'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// https://nodejs.org/api/module.html#moduleenablecompilecachecachedir
// https://github.com/nodejs/node/pull/54501
if (nodeModule.enableCompileCache && !process.env.NODE_DISABLE_COMPILE_CACHE) {
  try {
    nodeModule.enableCompileCache()
  }
  catch {
    // Ignore errors
  }
}

globalThis.__nuxt_cli__ = {
  startTime: Date.now(),
  entry: fileURLToPath(import.meta.url),
  devEntry: fileURLToPath(new URL('../dist/dev/index.mjs', import.meta.url)),
}

// eslint-disable-next-line antfu/no-top-level-await
const { runMain } = await import('../dist/index.mjs')

runMain()
