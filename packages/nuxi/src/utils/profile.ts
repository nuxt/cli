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
  try {
    await new Promise<void>((res, rej) => {
      session!.post('Profiler.enable', (err) => {
        if (err) {
          return rej(err)
        }
        session!.post('Profiler.start', (err) => {
          if (err) {
            return rej(err)
          }
          res()
        })
      })
    })
  }
  catch (err) {
    session.disconnect()
    session = undefined
    throw err
  }
}

export async function stopCpuProfile(outDir: string): Promise<string | undefined> {
  if (!session) {
    return
  }
  const s = session
  session = undefined
  const outPath = join(outDir, `profile-${profileCount++}.cpuprofile`)
  try {
    await new Promise<any>((resolve, reject) => {
      s.post('Profiler.stop', (err, params) => {
        if (err) {
          return reject(err)
        }

        if (!params?.profile) {
          return resolve(params)
        }

        try {
          mkdirSync(outDir, { recursive: true })
          writeFileSync(outPath, JSON.stringify(params.profile))
          logger.info(`CPU profile written to ${colors.cyan(outPath)}`)
          logger.info(`Open it in ${colors.cyan('https://www.speedscope.app')} or Chrome DevTools`)
        }
        catch {}

        resolve(params)
      })
    })
  }
  finally {
    s.disconnect()
  }
}
