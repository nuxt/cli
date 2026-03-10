import type { Session } from 'node:inspector'
import { mkdirSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { box } from '@clack/prompts'
import { colors } from 'consola/utils'
import { join, relative } from 'pathe'
import { themeColor } from './ascii'

const RELATIVE_PATH_RE = /^(?![^.]{1,2}\/)/

let session: Session | undefined
let profileCount = 0

export async function startCpuProfile(): Promise<void> {
  const cli = globalThis.__nuxt_cli__
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

export async function stopCpuProfile(outDir: string, command: string): Promise<string | undefined> {
  if (!session) {
    return
  }
  const s = session
  session = undefined
  const count = profileCount++
  const outPath = join(outDir, `nuxt-${command}${count ? `-${count}` : ''}.cpuprofile`)
  const relativeOutPath = relative(process.cwd(), outPath).replace(RELATIVE_PATH_RE, './')
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
          const nextSteps = [
            `CPU profile written to ${colors.cyan(relativeOutPath)}.`,
            `Open it in a CPU profile viewer like your IDE, or ${colors.cyan('https://discoveryjs.github.io/cpupro')}.`,
          ]
          box(`\n${nextSteps.map(step => ` › ${step}`).join('\n')}\n`, '', {
            contentAlign: 'left',
            titleAlign: 'left',
            width: 'auto',
            titlePadding: 2,
            contentPadding: 2,
            rounded: true,
            withGuide: false,
            formatBorder: (text: string) => `${themeColor + text}\x1B[0m`,
          })
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
