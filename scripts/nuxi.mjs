#!/usr/bin/env node
import jiti from 'jiti'
import { fileURLToPath } from 'node:url'

global.__nuxt_cli__ = {
  startTime: Date.now(),
  entry: fileURLToPath(import.meta.url),
}

const { runMain } = jiti(import.meta.url, {
  esmResolve: true,
})('../src/index.ts')

runMain()
