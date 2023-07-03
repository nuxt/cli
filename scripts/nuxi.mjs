#!/usr/bin/env node
import jiti from 'jiti'
import { runMain } from 'citty'

process._startTime = Date.now()

const { main } = jiti(import.meta.url, {
  esmResolve: true,
})('../src/index.ts')

runMain(main)
