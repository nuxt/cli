import os from 'node:os'
import { fileURLToPath } from 'node:url'

import { x } from 'tinyexec'
import { bench, describe } from 'vitest'

const fixtureDir = fileURLToPath(new URL('../../../../playground', import.meta.url))
const nuxiBin = fileURLToPath(new URL('../../bin/nuxi.mjs', import.meta.url))

describe(`build [${os.platform()}]`, () => {
  bench('nuxt build (child process)', async () => {
    await x('node', [nuxiBin, 'build', fixtureDir], {
      throwOnError: true,
      nodeOptions: {
        stdio: 'pipe',
        env: {
          ...process.env,
          CI: 'true',
          NO_COLOR: '1',
        },
      },
    })
  }, {
    warmupIterations: 0,
    iterations: 1,
    time: 0,
  })
})
