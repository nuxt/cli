#!/usr/bin/env node
import jiti from 'jiti'

process._startTime = Date.now()

const { runMain } = jiti(import.meta.url, {
  esmResolve: true,
})('../src/index.ts')

runMain()
