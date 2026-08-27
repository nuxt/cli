import { mkdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { join } from 'pathe'
import { isWindows } from 'std-env'
import { x } from 'tinyexec'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Which spec the user asked for is recovered by reading the command lines of
 * this process' ancestors, so the walk is exercised against a real process tree
 * rather than a list of strings.
 */

const headless = fileURLToPath(new URL('../../../src/utils/headless.ts', import.meta.url))

let dir: string
let probe: string

beforeAll(async () => {
  // Kept inside the package so the probe can resolve `jiti`, which is what lets
  // it load the module under test from source.
  dir = fileURLToPath(new URL('../../fixtures/.tmp-ancestors', import.meta.url))
  probe = join(dir, 'probe.mjs')
  await mkdir(dir, { recursive: true })
  await writeFile(probe, `import { createJiti } from 'jiti'\n\nconst jiti = createJiti(import.meta.url)\nconst { isPinnedCreateInvocation } = await jiti.import(${JSON.stringify(headless)})\nconsole.log(isPinnedCreateInvocation())\n`)
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** Run the probe under a shell whose own command line carries `comment`. */
async function ask(comment: string) {
  // The trailing `exit` keeps the shell from replacing itself with node, which
  // would take the command line being looked for with it.
  const result = await x('sh', ['-c', `node --no-warnings ${JSON.stringify(probe)} # ${comment}\nexit 0`], {
    nodeOptions: { stdio: 'pipe', cwd: dir },
  })
  return `${result.stdout}${result.stderr}`.trim()
}

describe.skipIf(isWindows)('isPinnedCreateInvocation', () => {
  it('should find a pinned spec in an ancestor command line', async () => {
    await expect(ask('npm create nuxt@latest my-app')).resolves.toBe('true')
  })

  it('should find a pinned spec written with a hyphen', async () => {
    await expect(ask('pnpm dlx create-nuxt@4.1.0 my-app')).resolves.toBe('true')
  })

  it('should report nothing pinned when no ancestor asked for a spec', async () => {
    await expect(ask('pnpm create nuxt my-app')).resolves.toBe('false')
  })
})
