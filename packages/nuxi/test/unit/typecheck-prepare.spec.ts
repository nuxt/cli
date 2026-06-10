import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { resolvePrepareDecision } = await import('../../src/commands/typecheck')
const { lockPathFor, locksDir } = await import('../../src/utils/lockfile')

function writeLock(dir: string, info: Record<string, unknown>) {
  mkdirSync(locksDir(dir), { recursive: true })
  writeFileSync(lockPathFor(dir, info.pid as number), JSON.stringify({ cwd: '/project', startedAt: Date.now(), ...info }))
}

describe('resolvePrepareDecision', () => {
  let buildDir: string
  let killSpy: ReturnType<typeof vi.spyOn> | undefined

  beforeEach(async () => {
    buildDir = await mkdtemp(join(tmpdir(), 'nuxt-typecheck-prepare-'))
    delete process.env.NUXT_IGNORE_LOCK
    delete process.env.NUXT_LOCK
  })

  afterEach(async () => {
    killSpy?.mockRestore()
    killSpy = undefined
    await rm(buildDir, { recursive: true, force: true })
  })

  function mockAlive(pid: number) {
    killSpy = vi.spyOn(process, 'kill').mockImplementation((p) => {
      if (p === pid) {
        return true as unknown as true
      }
      throw Object.assign(new Error('no such process'), { code: 'ESRCH' })
    })
  }

  it('prepares when no lock exists', () => {
    expect(resolvePrepareDecision(buildDir, {})).toEqual({ prepare: true })
  })

  it('skips prepare when a live dev server owns the buildDir, types are ready, and tsconfig exists', () => {
    mockAlive(424242)
    writeLock(buildDir, { pid: 424242, command: 'dev', typesReady: true })
    writeFileSync(join(buildDir, 'tsconfig.json'), '{}')
    expect(resolvePrepareDecision(buildDir, {})).toEqual({ prepare: false, reusingDevPid: 424242 })
  })

  it('prepares when the dev lock has not signalled typesReady (mid-rebuild / stale)', () => {
    mockAlive(424242)
    writeLock(buildDir, { pid: 424242, command: 'dev' }) // no typesReady
    writeFileSync(join(buildDir, 'tsconfig.json'), '{}')
    expect(resolvePrepareDecision(buildDir, {})).toEqual({ prepare: true })
  })

  it('prepares when typesReady is explicitly false', () => {
    mockAlive(424242)
    writeLock(buildDir, { pid: 424242, command: 'dev', typesReady: false })
    writeFileSync(join(buildDir, 'tsconfig.json'), '{}')
    expect(resolvePrepareDecision(buildDir, {})).toEqual({ prepare: true })
  })

  it('prepares when a live dev lock exists but types are not yet written', () => {
    mockAlive(424242)
    writeLock(buildDir, { pid: 424242, command: 'dev', typesReady: true })
    expect(resolvePrepareDecision(buildDir, {})).toEqual({ prepare: true })
  })

  it('prepares for a build lock (only dev servers keep types fresh)', () => {
    mockAlive(424242)
    writeLock(buildDir, { pid: 424242, command: 'build' })
    writeFileSync(join(buildDir, 'tsconfig.json'), '{}')
    expect(resolvePrepareDecision(buildDir, {})).toEqual({ prepare: true })
  })

  it('prepares when the lock belongs to a dead process', () => {
    writeLock(buildDir, { pid: 999999999, command: 'dev' })
    writeFileSync(join(buildDir, 'tsconfig.json'), '{}')
    expect(resolvePrepareDecision(buildDir, {})).toEqual({ prepare: true })
  })

  it('honours --prepare even with a live dev server', () => {
    mockAlive(424242)
    writeLock(buildDir, { pid: 424242, command: 'dev' })
    writeFileSync(join(buildDir, 'tsconfig.json'), '{}')
    expect(resolvePrepareDecision(buildDir, { prepare: true })).toEqual({ prepare: true })
  })

  it('honours --no-prepare even with no lock', () => {
    expect(resolvePrepareDecision(buildDir, { prepare: false })).toEqual({ prepare: false })
  })

  it('forces a prepare when --extends is passed (even with reusable types)', () => {
    mockAlive(424242)
    writeLock(buildDir, { pid: 424242, command: 'dev', typesReady: true })
    writeFileSync(join(buildDir, 'tsconfig.json'), '{}')
    expect(resolvePrepareDecision(buildDir, { extends: '../base' })).toEqual({ prepare: true })
  })
})
