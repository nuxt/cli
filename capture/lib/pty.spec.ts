import process from 'node:process'

import { describe, expect, it } from 'vitest'
import { record } from './pty.ts'

describe('record', () => {
  it.skipIf(process.platform === 'win32')('should keep a character whole when its bytes arrive in separate reads', async () => {
    const script = 'process.stdout.write(Buffer.from([0xE2, 0x94])); setTimeout(() => process.stdout.write(Buffer.from([0x80])), 200)'
    const session = record(`"${process.execPath}" -e '${script}'`, { columns: 80, rows: 24 })

    await session.exited

    expect(session.output()).toBe('\u2500')
  })
})
