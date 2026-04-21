import { execSync } from 'node:child_process'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

import { bench, describe } from 'vitest'

const fixtureDir = fileURLToPath(new URL('../../../../playground', import.meta.url))
const nuxiBin = fileURLToPath(new URL('../../../../packages/nuxi/bin/nuxi.mjs', import.meta.url))

describe(`build [${os.platform()}]`, () => {
  bench('nuxt build (child process)', async () => {
    execSync(`node ${nuxiBin} build ${fixtureDir}`, {
      stdio: 'pipe',
      env: {
        ...process.env,
        CI: 'true',
        NO_COLOR: '1',
      },
    })
  }, {
    warmupIterations: 0,
    iterations: 3,
    time: 0,
  })
})
