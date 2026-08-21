import type { Buffer } from 'node:buffer'
import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export interface Chunk {
  /** Milliseconds since the recording started. */
  at: number
  data: string
}

export interface PtyOptions {
  cwd?: string
  env?: Record<string, string | undefined>
  columns: number
  rows: number
}

export interface PtySession {
  chunks: Chunk[]
  /** Everything received so far, unscrubbed. */
  output: () => string
  send: (input: string) => void
  waitFor: (pattern: RegExp, timeout?: number) => Promise<void>
  wait: (ms: number) => Promise<void>
  exited: Promise<number | null>
  stop: () => Promise<void>
}

/**
 * The pty host for this platform, as command, argv and extra environment.
 *
 * On Linux, util-linux `script` provides the pty. BSD `script` (macOS)
 * refuses piped stdio (`tcgetattr: Operation not supported`), so a small
 * python shim hosts the pty there instead; python3 comes with the Xcode
 * command line tools every contributor already has.
 */
function ptyHost(shellLine: string): { command: string, args: string[], env: Record<string, string> } {
  if (process.platform === 'darwin' || process.env.CAPTURE_FORCE_SHIM === '1') {
    const shim = fileURLToPath(new URL('pty-host.py', import.meta.url))
    return { command: 'python3', args: [shim], env: { CAPTURE_CMD: shellLine } }
  }
  return { command: 'script', args: ['-q', '-e', '-c', shellLine, '/dev/null'], env: {} }
}

/**
 * Run a command inside a real pty of a fixed size, recording every byte it
 * writes along with the time it arrived.
 */
export function record(command: string, options: PtyOptions): PtySession {
  const started = performance.now()
  const chunks: Chunk[] = []
  let buffer = ''
  const waiters: { pattern: RegExp, resolve: () => void, reject: (error: Error) => void }[] = []

  const host = ptyHost(`stty rows ${options.rows} cols ${options.columns}; ${command}`)
  // The pty gives the recorded process a real TTY, so color support must not
  // be forced: FORCE_COLOR would leak into forked children whose stdout is a
  // pipe, flipping them to consola's fancy reporter (right-aligned timestamps
  // and all) when a real run re-emits their plain output through the parent.
  // CI (set on Actions runners) is dropped for the inverse reason.
  const env = { ...process.env, ...options.env, ...host.env, TERM: 'xterm-256color', COLUMNS: String(options.columns), LINES: String(options.rows) } as NodeJS.ProcessEnv
  delete env.FORCE_COLOR
  delete env.NO_COLOR
  delete env.CI
  delete env.GITHUB_ACTIONS
  const child: ChildProcess = spawn(host.command, host.args, {
    cwd: options.cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  child.stdout!.on('data', (chunk: Buffer) => {
    const data = chunk.toString()
    chunks.push({ at: performance.now() - started, data })
    buffer += data
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i]!.pattern.test(buffer)) {
        waiters.splice(i, 1)[0]!.resolve()
      }
    }
  })

  let stderr = ''
  child.stderr!.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })

  const exited = new Promise<number | null>((resolve) => {
    child.on('close', (code) => {
      if (code !== 0 && stderr.trim()) {
        console.error(`[capture] pty host exited with ${code}: ${stderr.trim()}`)
      }
      // A session that dies leaves its waiters unresolvable; better a clear
      // rejection than a drained event loop and an unsettled top-level await.
      for (const waiter of waiters.splice(0)) {
        waiter.reject(new Error(`session exited with ${code} while waiting for ${waiter.pattern}, saw:\n${buffer.slice(-1500)}`))
      }
      resolve(code)
    })
  })

  return {
    chunks,
    exited,
    output: () => buffer,
    send: input => child.stdin!.write(input),
    wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
    waitFor(pattern, timeout = 120_000) {
      if (pattern.test(buffer)) {
        return Promise.resolve()
      }
      return new Promise<void>((resolve, reject) => {
        const entry = { pattern, resolve, reject }
        waiters.push(entry)
        setTimeout(() => {
          const index = waiters.indexOf(entry)
          if (index !== -1) {
            waiters.splice(index, 1)
            reject(new Error(`timed out waiting for ${pattern}, saw:\n${buffer.slice(-1500)}`))
          }
        }, timeout).unref?.()
      })
    },
    async stop() {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM')
        const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
        await exited
        clearTimeout(timer)
      }
      await exited
    },
  }
}
