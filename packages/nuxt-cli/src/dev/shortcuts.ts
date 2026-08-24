import type { Listener } from './listen'

import process from 'node:process'
import { createInterface } from 'node:readline'

import { styleText } from 'node:util'
import { isCI, isTest } from 'std-env'

import { restoreRawMode, withDirectStdout } from '../utils/console'
import { copyURL, openBrowser, printQRCode } from './listen'

export interface ShortcutContext {
  listener: Listener
  close: () => Promise<void>
  restart?: () => void | Promise<void>
  /** Remove the caches that make the next start cold, naming what went. */
  clearCaches?: () => Promise<string[]>
  onReady: (callback: (address: string) => void) => void
}

interface ActionContext extends ShortcutContext {
  /** Stop reading shortcuts, so a quitting server does not keep stdin open. */
  closeInput: () => void
}

interface Shortcut {
  keys: string[]
  description: string
  isAvailable?: (context: ShortcutContext) => boolean
  action: (context: ActionContext) => void | Promise<void>
}

const shortcuts: Shortcut[] = [
  {
    keys: ['r', 'restart'],
    description: 'restart the dev server',
    isAvailable: context => !!context.restart,
    action: context => context.restart?.(),
  },
  {
    keys: ['o', 'open'],
    description: 'open in browser',
    action: context => openBrowser(context.listener.url),
  },
  {
    keys: ['u', 'urls'],
    description: 'show server URLs',
    action: context => context.listener.showURLs(),
  },
  {
    keys: ['qr'],
    description: 'show a QR code for the server URL',
    action: context => printQRCode(resolveShareableURL(context.listener), { showURL: true }),
  },
  {
    keys: ['copy'],
    description: 'copy the server URL to the clipboard',
    action: context => copyURL(resolveShareableURL(context.listener)),
  },
  {
    keys: ['c', 'clear'],
    description: 'clear the console',
    action: async (context) => {
      await withDirectStdout(() => process.stdout.write('\u001B[2J\u001B[3J\u001B[H'))
      context.listener.showURLs()
    },
  },
  {
    keys: ['q', 'quit', 'exit'],
    description: 'quit',
    action: quit,
  },
  {
    keys: ['h', 'help', '?'],
    description: 'show this help',
    action: printHelp,
  },
]

/** The URL most likely to work on another device, for QR codes and sharing. */
function resolveShareableURL(listener: Listener): string {
  return listener.qrURL
    || listener.publicURL
    || listener.getURLs().find(({ type }) => type === 'network')?.url
    || listener.url
}

async function quit(context: ActionContext): Promise<void> {
  context.closeInput()
  try {
    await context.close()
  }
  catch (error) {
    console.error(error)
    process.exitCode = 1
  }
  process.exit()
}

function printHelp(context: ActionContext): void {
  const lines = availableShortcuts(context).map(({ keys, description }) =>
    `  ${styleText('dim', 'press')} ${styleText('bold', `${keys[0]} + enter`)} ${styleText('dim', `to ${description}`)}`,
  )
  // eslint-disable-next-line no-console
  console.log(`\n${lines.join('\n')}\n`)
}

/**
 * Without a readable stdin there are no shortcuts to offer, so point at the way
 * to talk to the server instead: a caller driving the CLI without a keyboard
 * (an agent, a wrapper script) otherwise has no indication that one exists.
 *
 * `/` is suggested rather than an API route because it is the one path every
 * project serves.
 */
function printRequestHint(): void {
  // eslint-disable-next-line no-console
  console.log(`\n  ${styleText('dim', 'run')} ${styleText('bold', 'nuxt curl /')} ${styleText('dim', 'to send a request to this server')}\n`)
}

function availableShortcuts(context: ShortcutContext): Shortcut[] {
  return shortcuts.filter(shortcut => shortcut.isAvailable?.(context) !== false)
}

/**
 * Bind `<command> + enter` shortcuts to stdin.
 *
 * No output stream is passed to readline, so it stays in non-terminal mode and
 * does not intercept Ctrl-C or put stdin into raw mode.
 */
export function setupShortcuts(context: ShortcutContext): void {
  if (!process.stdin.isTTY || isCI || isTest) {
    // A hint written into a redirected log is read by nobody and answered by
    // nobody, so it is only offered while stdout is still a terminal.
    if (process.stdout.isTTY && !isCI && !isTest) {
      context.onReady(() => printRequestHint())
    }
    return
  }

  context.onReady(() => {
    // eslint-disable-next-line no-console
    console.log(`\n  ${styleText('dim', 'press')} ${styleText('bold', 'h + enter')} ${styleText('dim', 'to see available shortcuts')}\n`)
  })

  restoreRawMode()

  const rl = createInterface({ input: process.stdin })
  rl.on('line', async (line) => {
    const input = line.trim().toLowerCase()
    const shortcut = availableShortcuts(context).find(({ keys }) => keys.includes(input))
    if (!shortcut) {
      return
    }
    try {
      await shortcut.action({ ...context, closeInput: () => rl.close() })
    }
    catch (error) {
      console.error(error)
    }
  })
}
