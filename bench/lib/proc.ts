import type { Buffer } from 'node:buffer'
import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import process from 'node:process'

export interface RunOptions {
  cwd?: string
  env?: Record<string, string | undefined>
  timeout?: number
}

export interface RunResult {
  /** Wall time from spawn to process exit, in milliseconds. */
  wall: number
  /** Wall time from spawn to the first byte written to stdout or stderr. */
  ttfb: number
  code: number | null
  stdout: string
  stderr: string
}

export async function run(command: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  const started = performance.now()
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env } as NodeJS.ProcessEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })

  let ttfb = Number.NaN
  let stdout = ''
  let stderr = ''
  const mark = () => {
    if (Number.isNaN(ttfb)) {
      ttfb = performance.now() - started
    }
  }
  child.stdout.on('data', (chunk: Buffer) => {
    mark()
    stdout += chunk.toString()
  })
  child.stderr.on('data', (chunk: Buffer) => {
    mark()
    stderr += chunk.toString()
  })

  const timeout = options.timeout ?? 300_000
  const timer = setTimeout(kill, timeout, child)
  const code = await new Promise<number | null>((resolve) => {
    child.on('close', resolve)
  })
  clearTimeout(timer)

  return { wall: performance.now() - started, ttfb, code, stdout, stderr }
}

function kill(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }
  try {
    process.kill(-child.pid!, 'SIGKILL')
  }
  catch {
    child.kill('SIGKILL')
  }
}

export interface BackgroundProcess {
  child: ChildProcess
  output: () => string
  /** Resolves with the elapsed time in ms from `start` to the first output matching `pattern`. */
  waitFor: (pattern: RegExp, timeout?: number) => Promise<number>
  /** Resets the clock that `waitFor` measures against, for restart timings. */
  resetClock: () => void
  stop: () => Promise<void>
}

export function start(command: string, args: string[], options: RunOptions = {}): BackgroundProcess {
  let clock = performance.now()
  let buffer = ''
  const waiters: { pattern: RegExp, resolve: (ms: number) => void }[] = []

  const child = spawn(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env } as NodeJS.ProcessEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })

  const onData = (chunk: Buffer) => {
    const elapsed = performance.now() - clock
    buffer += chunk.toString()
    for (let i = waiters.length - 1; i >= 0; i--) {
      const waiter = waiters[i]!
      if (waiter.pattern.test(buffer)) {
        waiters.splice(i, 1)
        waiter.resolve(elapsed)
      }
    }
  }
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)

  return {
    child,
    output: () => buffer,
    resetClock: () => {
      clock = performance.now()
      buffer = ''
    },
    waitFor(pattern, timeout = 300_000) {
      if (pattern.test(buffer)) {
        return Promise.resolve(performance.now() - clock)
      }
      return new Promise<number>((resolve, reject) => {
        const entry = { pattern, resolve }
        waiters.push(entry)
        setTimeout(() => {
          const index = waiters.indexOf(entry)
          if (index !== -1) {
            waiters.splice(index, 1)
            reject(new Error(`timed out waiting for ${pattern} in:\n${buffer.slice(-2000)}`))
          }
        }, timeout).unref?.()
      })
    },
    async stop() {
      kill(child)
      await new Promise(resolve => child.on('close', resolve))
    },
  }
}

export async function waitForHttp(url: string, since = performance.now(), timeout = 300_000): Promise<number> {
  const started = since
  while (performance.now() - started < timeout) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        await response.text()
        return performance.now() - since
      }
    }
    catch {
      // server is not accepting connections yet
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`timed out waiting for ${url}`)
}
