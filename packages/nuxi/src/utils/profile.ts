import type { Session } from 'node:inspector'
import { mkdirSync, writeFileSync } from 'node:fs'
import { colors } from 'consola/utils'
import { join } from 'pathe'
import { logger } from './logger'

let session: Session | undefined
let profileCount = 0

export async function startCpuProfile(): Promise<void> {
  const cli = globalThis.__nuxt_cli__ as Record<string, any> | undefined
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
        else {
          res()
        }
      })
    })
  })
}

export function stopCpuProfile(outDir: string): string | undefined {
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
