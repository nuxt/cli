import { Buffer } from 'node:buffer'
import process from 'node:process'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { writeClipboard } from '../../src/utils/clipboard'
import { registerTerminalHost } from '../../src/utils/terminal-host'

const writeText = vi.hoisted(() => vi.fn())
const stdEnv = vi.hoisted(() => ({ isCI: false }))

vi.mock('tinyclip', () => ({ writeText }))

vi.mock('std-env', async importOriginal => ({
  ...await importOriginal<typeof import('std-env')>(),
  get isCI() {
    return stdEnv.isCI
  },
}))

const realPlatform = process.platform
const realEnv = { ...process.env }
const realIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')

function stubEnvironment(platform: NodeJS.Platform, env: NodeJS.ProcessEnv = {}) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  process.env = {
    ...realEnv,
    DISPLAY: undefined,
    WAYLAND_DISPLAY: undefined,
    WSL_DISTRO_NAME: undefined,
    TERM: undefined,
    TERM_PROGRAM: undefined,
    TMUX: undefined,
    ...env,
  }
}

function stubTTY(isTTY: boolean) {
  Object.defineProperty(process.stdout, 'isTTY', { value: isTTY, configurable: true })
}

function osc52(text: string): string {
  return `\u001B]52;c;${Buffer.from(text, 'utf8').toString('base64')}\u0007`
}

describe('writeClipboard', () => {
  beforeEach(() => stubTTY(true))

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true })
    process.env = { ...realEnv }
    if (realIsTTY) {
      Object.defineProperty(process.stdout, 'isTTY', realIsTTY)
    }
    else {
      Reflect.deleteProperty(process.stdout, 'isTTY')
    }
    stdEnv.isCI = false
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('should use the platform clipboard where there is one to write to', async () => {
    stubEnvironment('darwin', { TERM: 'xterm-kitty' })
    const write = vi.fn()

    await expect(writeClipboard('text', { write })).resolves.toBe(true)

    expect(writeText).toHaveBeenCalledWith('text')
    expect(write).not.toHaveBeenCalled()
  })

  it('should not reach for a clipboard tool without a display server on linux', async () => {
    stubEnvironment('linux')

    await expect(writeClipboard('text', {
      write: vi.fn(),
    })).resolves.toBe(false)

    expect(writeText).not.toHaveBeenCalled()
  })

  it('should resolve false rather than throw when the platform write fails', async () => {
    stubEnvironment('darwin')
    writeText.mockRejectedValueOnce(new Error('no clipboard tool found'))

    await expect(writeClipboard('text', {
      write: vi.fn(),
    })).resolves.toBe(false)
  })

  it('should ask the terminal to set the clipboard when there is no display server', async () => {
    stubEnvironment('linux', { TERM: 'xterm-kitty' })
    const write = vi.fn()

    await expect(writeClipboard('héllo ✨', { write })).resolves.toBe(true)

    expect(write).toHaveBeenCalledWith(osc52('héllo ✨'))
  })

  it('should fall back to the terminal when the platform tool fails', async () => {
    stubEnvironment('linux', { DISPLAY: ':0', TERM_PROGRAM: 'WezTerm' })
    writeText.mockRejectedValueOnce(new Error('xclip not found'))
    const write = vi.fn()

    await expect(writeClipboard('text', { write })).resolves.toBe(true)

    expect(write).toHaveBeenCalledWith(osc52('text'))
  })

  it.each([
    { TERM: 'tmux-256color' },
    { TERM: 'screen-256color', TMUX: '/tmp/tmux-501/default,123,0' },
  ])('should leave relaying to tmux (%o)', async (env) => {
    stubEnvironment('linux', env)
    const write = vi.fn()

    await expect(writeClipboard('text', { write })).resolves.toBe(true)

    expect(write).toHaveBeenCalledWith(osc52('text'))
  })

  it('should leave GNU screen alone', async () => {
    stubEnvironment('linux', { TERM: 'screen-256color', STY: '123.pts-0.host' })
    const write = vi.fn()

    await expect(writeClipboard('text', { write })).resolves.toBe(false)

    expect(write).not.toHaveBeenCalled()
  })

  it('should recognise a supporting terminal by TERM_PROGRAM', async () => {
    stubEnvironment('linux', { TERM: 'xterm-256color', TERM_PROGRAM: 'ghostty' })
    const write = vi.fn()

    await expect(writeClipboard('text', { write })).resolves.toBe(true)

    expect(write).toHaveBeenCalledWith(osc52('text'))
  })

  it('should write to stdout when no writer is given', async () => {
    stubEnvironment('linux', { TERM: 'xterm-kitty' })
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await expect(writeClipboard('text')).resolves.toBe(true)

    expect(write).toHaveBeenCalledWith(osc52('text'))
  })

  it('should write below a line-wrapping logger on stdout', async () => {
    stubEnvironment('linux', { TERM: 'xterm-kitty' })
    const stdout = process.stdout as NodeJS.WriteStream & { __write?: typeof process.stdout.write }
    const raw = vi.fn(() => true)
    const logged = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    stdout.__write = raw as any

    try {
      await expect(writeClipboard('text')).resolves.toBe(true)

      expect(raw).toHaveBeenCalledWith(osc52('text'))
      expect(logged).not.toHaveBeenCalled()
    }
    finally {
      delete stdout.__write
    }
  })

  it('should leave a terminal that is not known to support OSC 52 alone', async () => {
    stubEnvironment('linux', { TERM: 'xterm-256color' })
    const write = vi.fn()

    await expect(writeClipboard('text', { write })).resolves.toBe(false)

    expect(write).not.toHaveBeenCalled()
  })

  it('should not write escape sequences when stdout is not a terminal', async () => {
    stubEnvironment('linux', { TERM: 'xterm-kitty' })
    stubTTY(false)
    const write = vi.fn()

    await expect(writeClipboard('text', { write })).resolves.toBe(false)

    expect(write).not.toHaveBeenCalled()
  })

  it('should not write escape sequences in CI', async () => {
    stubEnvironment('linux', { TERM: 'xterm-kitty' })
    stdEnv.isCI = true
    const write = vi.fn()

    await expect(writeClipboard('text', { write })).resolves.toBe(false)

    expect(write).not.toHaveBeenCalled()
  })

  it('should not write to stdout while a terminal host owns it', async () => {
    stubEnvironment('linux', { TERM: 'xterm-kitty' })
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const release = registerTerminalHost({
      version: 1,
      withTerminal: work => work(),
      startTask: () => ({
        update: () => {},
        stop: () => {},
      }),
    })

    try {
      await expect(writeClipboard('text')).resolves.toBe(false)

      expect(write).not.toHaveBeenCalled()
    }
    finally {
      release()
    }
  })
})
