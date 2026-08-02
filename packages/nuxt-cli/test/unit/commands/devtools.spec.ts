import { resolve } from 'pathe'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { runCommand } from '../../../src/run'

const { x } = vi.hoisted(() => ({
  x: vi.fn(() => Promise.resolve({ exitCode: 0 })),
}))

vi.mock('tinyexec', () => ({ x }))

describe('nuxt devtools command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(['enable', 'disable'])('runs the devtools wizard to %s devtools', async (action) => {
    await runCommand('devtools', [action, 'apps/web'])

    expect(x).toHaveBeenCalledOnce()
    expect(x).toHaveBeenCalledWith(
      'npx',
      ['--yes', '@nuxt/devtools-wizard@latest', action],
      {
        throwOnError: true,
        nodeOptions: {
          stdio: 'inherit',
          cwd: resolve('apps/web'),
        },
      },
    )
  })

  it('rejects unknown actions without terminating programmatic callers', async () => {
    await expect(runCommand('devtools', ['toggle'])).rejects.toThrow(
      'Unknown devtools command `toggle`. Expected `enable` or `disable`.',
    )
    expect(x).not.toHaveBeenCalled()
  })
})
