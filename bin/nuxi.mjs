#!/usr/bin/env node
process._startTime = Date.now()
process._cliEntry = import.meta.url
import('../dist/cli.mjs').then((r) => (r.default || r).main())
