#!/usr/bin/env node

import { fileURLToPath } from 'node:url'
import { runMain } from '../dist/index.mjs'

globalThis.__nuxt_cli__ = {
  startTime: Date.now(),
  entry: fileURLToPath(import.meta.url),
  devEntry: fileURLToPath(new URL('../dist/dev/index.mjs', import.meta.url)),
}

runMain()
