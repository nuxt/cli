import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import { join } from 'pathe'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { startCpuProfile, stopCpuProfile } from '../../../src/utils/profile'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nuxt-profile-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  Reflect.deleteProperty(globalThis, '__nuxt_cli__')
})

/** Keep the profiler busy so it has at least one sample to report. */
function work() {
  let total = 0
  for (let index = 0; index < 1e6; index++) {
    total += Math.sqrt(index)
  }
  return total
}

describe('cpu profiling', () => {
  it('should write a profile a viewer can read', async () => {
    await startCpuProfile()
    work()

    const outPath = await stopCpuProfile(join(root, 'profiles'), 'dev')

    expect(outPath).toMatch(/profiles\/nuxt-dev(-\d+)?\.cpuprofile$/)
    const profile = JSON.parse(await readFile(outPath!, 'utf8'))
    expect(profile.nodes.length).toBeGreaterThan(0)
    expect(profile.startTime).toBeLessThanOrEqual(profile.endTime)
  })

  it('should do nothing when no profile was started', async () => {
    await expect(stopCpuProfile(root, 'build')).resolves.toBeUndefined()

    await expect(readdir(root)).resolves.toEqual([])
  })

  it('should not overwrite an earlier profile of the same command', async () => {
    await startCpuProfile()
    work()
    const first = await stopCpuProfile(root, 'dev')

    await startCpuProfile()
    work()
    const second = await stopCpuProfile(root, 'dev')

    expect(first).not.toBe(second)
    expect((await readdir(root)).length).toBe(2)
  })

  it('should adopt a session the launcher started', async () => {
    await startCpuProfile()
    const adopted = await stopCpuProfile(root, 'handover')
    expect(adopted).toBeDefined()

    // The launcher connects the session before the CLI is loaded, so that it can
    // profile the CLI's own startup, and hands it over through the global.
    const inspector = await import('node:inspector')
    const session = new inspector.Session()
    session.connect()
    await new Promise<void>((resolve, reject) => {
      session.post('Profiler.enable', error => error ? reject(error) : session.post('Profiler.start', error => error ? reject(error) : resolve()))
    })
    Object.assign(globalThis, { __nuxt_cli__: { entry: 'test', startTime: 0, cpuProfileSession: session } })

    await startCpuProfile()
    work()

    expect(globalThis.__nuxt_cli__?.cpuProfileSession, 'the session should be taken off the global').toBeUndefined()
    // The counter that keeps profiles of the same command apart is per-process,
    // so an earlier profile in this file may have claimed the unsuffixed name.
    await expect(stopCpuProfile(root, 'launcher')).resolves.toMatch(/nuxt-launcher(-\d+)?\.cpuprofile$/)
  })

  it('should stop a session that could not be started', async () => {
    await startCpuProfile()
    await stopCpuProfile(root, 'reset')

    const inspector = await import('node:inspector')
    const session = new inspector.Session()
    Object.assign(globalThis, { __nuxt_cli__: { entry: 'test', startTime: 0, cpuProfileSession: session } })

    // A disconnected session cannot report, so the stop reports nothing rather
    // than throwing out of the command it was profiling.
    await startCpuProfile()

    await expect(stopCpuProfile(root, 'broken')).rejects.toThrow()
  })
})
