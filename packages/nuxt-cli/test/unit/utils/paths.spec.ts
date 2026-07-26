import { join } from 'node:path'
import process from 'node:process'

import { describe, expect, it, vi } from 'vitest'

import { relativeToProcess } from '../../../src/utils/paths'

describe('relativeToProcess', () => {
  it('should label paths relative to the working directory', () => {
    vi.stubEnv('FORCE_HYPERLINK', '0')
    expect(relativeToProcess(join(process.cwd(), 'src', 'app.vue'))).toBe(join('src', 'app.vue'))
    expect(relativeToProcess(process.cwd())).toBe(process.cwd())
  })
})
