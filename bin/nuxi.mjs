#!/usr/bin/env node

import { runMain } from 'citty'
import mainCommand from '../dist/index.mjs'

process._startTime = Date.now()

runMain(mainCommand)
