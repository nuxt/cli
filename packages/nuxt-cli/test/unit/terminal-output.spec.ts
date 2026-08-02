import type { Renderer } from 'ansivision'
import type { Listener } from '../../src/dev/listen'
import type { ShortcutContext } from '../../src/dev/shortcuts'

import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { colourOf, render, screen as visibleScreen } from '../utils/terminal'

vi.mock('std-env', () => ({ isCI: false, isTest: false, provider: undefined }))

// The suite may itself run inside a container, so the environment the URL block
// describes is stubbed rather than detected.
const isolatedEnvironment = vi.hoisted(() => ({ current: undefined as string | undefined }))

vi.mock('../../src/dev/environment', () => ({
  isDocker: () => false,
  isWsl: () => false,
  detectIsolatedEnvironment: () => isolatedEnvironment.current,
}))

const { listen, openBrowser, printQRCode } = await import('../../src/dev/listen')
const { setupShortcuts } = await import('../../src/dev/shortcuts')

/** SGR foreground colour indexes, as reported by `ansivision`. */
const GREEN = 2
const MAGENTA = 5
const CYAN = 6

/** The visible screen, with ports and QR codes replaced by stable markers. */
function screen(renderer: Renderer): string {
  return visibleScreen(renderer)
    .replaceAll(/:\d{4,5}\b/g, ':<port>')
    .replaceAll(/[\u2580-\u259F]+/g, '<qr>')
}

/** Pretend to be a Linux desktop running `browser`, or a headless one. */
function stubDisplay({ browser, browserArgs }: { browser?: string, browserArgs?: string } = {}): () => void {
  const platform = process.platform
  const env = { ...process.env }
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
  process.env = {
    ...env,
    DISPLAY: browser ? ':0' : undefined,
    WAYLAND_DISPLAY: undefined,
    WSL_DISTRO_NAME: undefined,
    BROWSER: browser,
    BROWSER_ARGS: browserArgs,
  }
  return () => {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true })
    process.env = env
  }
}

describe('dev server terminal output', () => {
  const listeners: Listener[] = []

  afterEach(async () => {
    await Promise.all(listeners.splice(0).map(listener => listener.close()))
    isolatedEnvironment.current = undefined
    vi.restoreAllMocks()
  })

  async function start(options: Parameters<typeof listen>[1] = {}) {
    const listener = await listen((_req, res) => res.end('ok'), { port: 0, qr: false, ...options })
    listeners.push(listener)
    return listener
  }

  async function withShortcuts(context: Partial<ShortcutContext> = {}, options: Parameters<typeof listen>[1] = {}) {
    const stdin = new PassThrough() as unknown as typeof process.stdin
    Object.assign(stdin, { isTTY: true })
    vi.spyOn(process, 'stdin', 'get').mockReturnValue(stdin)

    const listener = await start({ showURL: false, ...options })
    setupShortcuts({
      listener,
      close: async () => {},
      onReady: callback => callback(listener.url),
      ...context,
    })

    return {
      listener,
      press: async (input: string) => {
        stdin.write(`${input}\n`)
        await new Promise(resolve => setImmediate(resolve))
      },
    }
  }

  describe('startup', () => {
    it('should print the url block', async () => {
      const renderer = await render(() => start())

      expect(screen(renderer)).toMatchInlineSnapshot(`
        "  ➜ Local:    http://localhost:<port>/
          ➜ Network:  use --host to expose"
      `)
    })

    it('should expose the server inside a container', async () => {
      isolatedEnvironment.current = 'the container'
      const renderer = await render(() => start())

      expect(screen(renderer)).toContain('➜ Local:    http://localhost:<port>/')
      expect(screen(renderer)).not.toContain('use --host')
    })

    it('should colour each url type differently', async () => {
      const renderer = await render(() => start())
      renderer.goToFrame(renderer.frames.length - 1)

      expect(renderer.currentStyledFrame).toContain('\u001B[')
      expect(colourOf(renderer, 'Local:')).toBe(GREEN)
      expect(colourOf(renderer, 'Network:')).toBe(MAGENTA)
      expect(colourOf(renderer, 'http://localhost')).toBe(CYAN)
    })

    it('should flag which url the qr code points at', async () => {
      const renderer = await render(() => start({ qr: true, publicURL: 'https://example.com/' }))

      expect(screen(renderer)).toContain('<qr>')
      expect(screen(renderer)).toContain('https://example.com/ [QR code]')
    })

    it('should not caption the qr code, which the url block already labels', async () => {
      const renderer = await render(() => start({ qr: true }))

      expect(screen(renderer)).not.toMatch(/<qr>\n\s+http/)
    })
  })

  describe('shortcuts', () => {
    it('should hint at the help shortcut once the server is ready', async () => {
      const renderer = await render(() => withShortcuts())

      expect(screen(renderer)).toContain('press h + enter to see available shortcuts')
    })

    it('should caption a standalone qr code with its url', async () => {
      const renderer = await render(() => printQRCode('http://192.168.1.20:3000/', { showURL: true }))
      const lines = screen(renderer).split('\n').filter(Boolean)

      expect(lines.at(-1)).toContain('http://192.168.1.20:<port>/')
      // The caption is centred under the code rather than flush left.
      expect(lines.at(-1)!.startsWith(' ')).toBe(true)
    })

    it('should leave only the url block on screen after clearing', async () => {
      const { press } = await withShortcuts()

      const renderer = await render(async () => {
        // eslint-disable-next-line no-console
        console.log('noise from a previous build')
        await press('clear')
      })

      expect(screen(renderer)).toMatchInlineSnapshot(`
        "  ➜ Local:    http://localhost:<port>/
          ➜ Network:  use --host to expose"
      `)
      expect(renderer.frames.at(-1)).not.toContain('noise from a previous build')
    })

    it('should point a requested qr code at the public url', async () => {
      const { press } = await withShortcuts({}, { publicURL: 'https://example.com/' })

      const renderer = await render(() => press('qr'))

      expect(screen(renderer).split('\n').filter(Boolean).at(-1)).toContain('https://example.com/')
    })

    it('should say so when there is no clipboard to copy to', async () => {
      const restore = stubDisplay()
      const { press } = await withShortcuts()

      const renderer = await render(() => press('copy'))
      restore()

      expect(screen(renderer)).toContain('No clipboard is available in this environment.')
    })

    it('should list the available shortcuts', async () => {
      const { press } = await withShortcuts()

      const renderer = await render(() => press('h'))

      expect(screen(renderer)).toMatchInlineSnapshot(`
        "  press o + enter to open in browser
          press u + enter to show server URLs
          press qr + enter to show a QR code for the server URL
          press copy + enter to copy the server URL to the clipboard
          press c + enter to clear the console
          press q + enter to quit
          press h + enter to show this help"
      `)
    })

    it('should list restart first when a restart handler is available', async () => {
      const { press } = await withShortcuts({ restart: () => {} })

      const renderer = await render(() => press('h'))

      expect(screen(renderer).split('\n')[0]).toContain('press r + enter to restart the dev server')
    })
  })

  describe('browser launch', () => {
    it('should say so when the browser launcher fails', async () => {
      const restore = stubDisplay({ browser: '/definitely/not/a/launcher' })

      const renderer = await render(async ({ waitForOutput }) => {
        openBrowser('http://localhost:3000/')
        await waitForOutput('Could not open')
      })
      restore()

      expect(screen(renderer)).toContain('Could not open http://localhost:<port>/ in a browser.')
    })

    it('should say so when the browser launcher exits with an error', async () => {
      // A launcher that fails, without depending on a platform-specific binary.
      const restore = stubDisplay({ browser: process.execPath, browserArgs: '-e process.exit(1)' })

      const renderer = await render(async ({ waitForOutput }) => {
        openBrowser('http://localhost:3000/')
        await waitForOutput('Could not open')
      })
      restore()

      expect(screen(renderer)).toContain('Could not open http://localhost:<port>/ in a browser.')
    })

    it('should say so when there is no browser to open', async () => {
      const restore = stubDisplay()
      const { press } = await withShortcuts()

      const renderer = await render(() => press('o'))
      restore()

      expect(screen(renderer)).toContain('No browser is available in this environment. Open http://localhost:<port>/ manually.')
    })
  })
})
