#!/usr/bin/env node

import { runMain } from '../dist/index.mjs'

process._startTime = Date.now()

runMain()
