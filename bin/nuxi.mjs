#!/usr/bin/env node

import { runMain } from 'citty'
import { main } from '../dist/index.mjs'

process._startTime = Date.now()

runMain(main)
