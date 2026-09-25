import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { resolveCertificate } from '../../src/dev/cert'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true, maxRetries: 3 })))
})

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'nuxi-cert-'))
  dirs.push(dir)
  return dir
}

describe('resolving a certificate the user supplied', () => {
  it('should read the pair it is pointed at', async () => {
    const dir = await scratch()
    await writeFile(join(dir, 'cert.pem'), 'certificate')
    await writeFile(join(dir, 'key.pem'), 'private key')

    await expect(resolveCertificate({ cert: join(dir, 'cert.pem'), key: join(dir, 'key.pem') }))
      .resolves
      .toMatchObject({ cert: 'certificate', key: 'private key' })
  })

  it('should name the missing file and the flag that pointed at it', async () => {
    const dir = await scratch()
    await writeFile(join(dir, 'key.pem'), 'private key')

    await expect(resolveCertificate({ cert: join(dir, 'absent.pem'), key: join(dir, 'key.pem') }))
      .rejects
      .toThrow(/There is no file at .*absent\.pem, given as --https\.cert/)
  })

  it('should say the same for a keystore', async () => {
    const dir = await scratch()

    await expect(resolveCertificate({ pfx: join(dir, 'absent.p12') }))
      .rejects
      .toThrow(/absent\.p12, given as --https\.pfx/)
  })
})
