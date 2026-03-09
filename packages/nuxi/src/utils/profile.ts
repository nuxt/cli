import type { Session } from 'node:inspector'
import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { colors } from 'consola/utils'
import { join } from 'pathe'
import { logger } from './logger'

let session: Session | undefined
let profileCount = 0

export async function startCpuProfile(): Promise<void> {
  // Adopt session started in bin/nuxi.mjs
  const cli = globalThis.__nuxt_cli__ as typeof globalThis.__nuxt_cli__ & { cpuProfileSession?: import('node:inspector').Session }
  if (cli?.cpuProfileSession) {
    session = cli.cpuProfileSession
    delete cli.cpuProfileSession
    return
  }
  const inspector = await import('node:inspector')
  session = new inspector.Session()
  session.connect()
  await new Promise<void>((res, rej) => {
    session!.post('Profiler.enable', () => {
      session!.post('Profiler.start', (err) => {
        if (err) {
          rej(err)
        }
        else { res() }
      })
    })
  })
}

export function stopCpuProfile(outDir: string): Promise<string | undefined> {
  if (!session) {
    return Promise.resolve(undefined)
  }
  const s = session
  session = undefined
  return new Promise((res, rej) => {
    s.post('Profiler.stop', (err, { profile }) => {
      if (err) {
        return rej(err)
      }
      const outPath = join(outDir, `profile-${profileCount++}.cpuprofile`)
      mkdir(outDir, { recursive: true })
        .then(() => writeFile(outPath, JSON.stringify(profile)))
        .then(() => {
          logger.info(`CPU profile written to ${colors.cyan(outPath)}`)
          logger.info(`Open it in ${colors.cyan('https://www.speedscope.app')} or Chrome DevTools`)
          s.disconnect()
          res(outPath)
        })
        .catch(rej)
    })
  })
}

export function stopCpuProfileSync(outDir: string): string | undefined {
  if (!session) {
    return
  }
  const s = session
  session = undefined
  let outPath: string | undefined
  s.post('Profiler.stop', (_err, params) => {
    if (_err || !params?.profile) {
      return
    }
    outPath = join(outDir, `profile-${profileCount++}.cpuprofile`)
    try {
      mkdirSync(outDir, { recursive: true })
      writeFileSync(outPath, JSON.stringify(params.profile))
      logger.info(`CPU profile written to ${colors.cyan(outPath)}`)
      logger.info(`Open it in ${colors.cyan('https://www.speedscope.app')} or Chrome DevTools`)
    }
    catch {}
    s.disconnect()
  })
  return outPath
}

/**
 * Install signal handlers that flush the CPU profile before exit.
 * Returns a cleanup function to remove the handlers.
 */
export function installSignalHandlers(outDir: string): () => void {
  const onSignal = (signal: NodeJS.Signals) => {
    stopCpuProfileSync(outDir)
    process.kill(process.pid, signal)
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  return () => {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
  }
}
