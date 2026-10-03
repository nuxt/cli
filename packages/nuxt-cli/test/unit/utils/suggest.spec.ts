import { describe, expect, it } from 'vitest'

import { commands } from '../../../src/commands'
import { suggestCommand, suggestFlag } from '../../../src/utils/suggest'

const names = Object.keys(commands).filter(name => !name.startsWith('_'))

describe('suggestCommand', () => {
  it.each([
    ['biuld', 'build'],
    ['buidl', 'build'],
    ['buld', 'build'],
    ['upgarde', 'upgrade'],
    ['tpyecheck', 'typecheck'],
    ['moduel', 'module'],
    ['infp', 'info'],
    ['mod', 'module'],
    ['gen', 'generate'],
    ['clean', 'cleanup'],
  ])('suggests %s -> %s', async (input, expected) => {
    await expect(suggestCommand(input, names)).resolves.toBe(expected)
  })

  it.each([
    'zzzz',
    'deploy',
    'lint',
    'serve',
    'a',
    '',
  ])('stays quiet for %s', async (input) => {
    await expect(suggestCommand(input, names)).resolves.toBeUndefined()
  })

  it('never suggests a command that already exists', async () => {
    for (const name of names) {
      await expect(suggestCommand(name, names)).resolves.toBeUndefined()
    }
  })

  it('is case insensitive', async () => {
    await expect(suggestCommand('BIULD', names)).resolves.toBe('build')
  })
})

describe('suggestFlag', () => {
  const candidates = ['dotenv', 'logLevel', 'strictPort', 'port']

  it('matches a differently cased spelling', async () => {
    await expect(suggestFlag('loglevel', candidates)).resolves.toBe('logLevel')
  })

  it('leaves an exact candidate alone', async () => {
    await expect(suggestFlag('logLevel', candidates)).resolves.toBeUndefined()
  })

  it('holds command suggestions to a higher bar than flag suggestions', async () => {
    await expect(suggestFlag('dtnv', candidates)).resolves.toBe('dotenv')
    await expect(suggestCommand('dtnv', candidates)).resolves.toBeUndefined()
  })

  it('rejects a tie only when the policy asks it to', async () => {
    const tied = ['task', 'test']
    await expect(suggestCommand('tesk', tied)).resolves.toBeUndefined()
    await expect(suggestFlag('tesk', tied)).resolves.toBe('task')
  })
})
