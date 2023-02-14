#!/usr/bin/env node
process._startTime = Date.now()
import('../src/cli').then(r => (r.default || r).main())
