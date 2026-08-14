import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import command from '../../../src/commands/add-template'
import { runCommandDef } from '../../../src/run-command'

let cwd: string

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'nuxt-add-template-'))
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`process exited with code ${code}`)
  })
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(cwd, { recursive: true, force: true })
})

async function run(...args: string[]) {
  return runCommandDef(command, [...args, '--cwd', cwd])
}

describe('add-template command', () => {
  it('generates nested templates and strips only the final supported extension', async () => {
    await run('component', 'admin/user-card.vue')

    const path = join(cwd, 'components/admin/user-card.vue')
    expect(await readFile(path, 'utf8')).toContain('Component: admin/user-card')
    expect(await readFile(path, 'utf8')).toMatch(/\n$/)
  })

  it('uses a project stub when one exists for the template', async () => {
    await mkdir(join(cwd, 'stubs'))
    await writeFile(join(cwd, 'stubs/component.vue'), '<template>custom component</template>\n')

    await run('component', 'user-card')

    await expect(readFile(join(cwd, 'components/user-card.vue'), 'utf8')).resolves.toBe('<template>custom component</template>\n')
  })

  it('exposes template-specific options', async () => {
    await run('api', 'users', '--method', 'get')
    await run('component', 'island', '--mode', 'client')
    await run('middleware', 'auth', '--global')
    await run('server-route', 'health', '--api')
    await run('app', 'ignored', '--pages')

    await expect(readFile(join(cwd, 'server/api/users.get.ts'), 'utf8')).resolves.toContain('return \'Hello users\'')
    await expect(readFile(join(cwd, 'components/island.client.vue'), 'utf8')).resolves.toContain('Component: island')
    await expect(readFile(join(cwd, 'middleware/auth.global.ts'), 'utf8')).resolves.toContain('defineNuxtRouteMiddleware')
    await expect(readFile(join(cwd, 'server/api/health.ts'), 'utf8')).resolves.toContain('defineEventHandler')
    await expect(readFile(join(cwd, 'app.vue'), 'utf8')).resolves.toContain('<NuxtPage/>')
  })

  it('rejects unsupported suffix options', async () => {
    await expect(run('component', 'island', '--mode', 'worker')).rejects.toThrow('process exited with code 1')
    await expect(run('api', 'users', '--method', 'fetch')).rejects.toThrow('process exited with code 1')
  })

  it('rejects names containing only an extension', async () => {
    await expect(run('component', '.vue')).rejects.toThrow('process exited with code 1')
    await expect(readFile(join(cwd, 'components/.vue'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not overwrite an existing file without force', async () => {
    await run('composable', 'counter')
    const path = join(cwd, 'composables/counter.ts')
    await writeFile(path, 'existing\n')

    await expect(run('composable', 'counter')).rejects.toThrow()
    await expect(readFile(path, 'utf8')).resolves.toBe('existing\n')

    await run('composable', 'counter', '--force')
    await expect(readFile(path, 'utf8')).resolves.toContain('export const useCounter')
  })
})
