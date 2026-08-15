import { describe, expect, it } from 'vitest'

import { commands } from '../../../src/commands'
import { commandPolicy, flagPolicy, suggestClosest } from '../../../src/utils/suggest'
import { suggestCommand } from '../../../src/utils/suggest-command'

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

describe('suggestClosest', () => {
  const candidates = ['dotenv', 'logLevel', 'strictPort', 'port']

  it('matches a differently cased spelling', async () => {
    await expect(suggestClosest('loglevel', candidates, flagPolicy)).resolves.toBe('logLevel')
  })

  it('leaves an exact candidate alone', async () => {
    await expect(suggestClosest('logLevel', candidates, flagPolicy)).resolves.toBeUndefined()
  })

  it('holds command suggestions to a higher bar than flag suggestions', async () => {
    await expect(suggestClosest('dtnv', candidates, flagPolicy)).resolves.toBe('dotenv')
    await expect(suggestClosest('dtnv', candidates, commandPolicy)).resolves.toBeUndefined()
  })

  it('rejects a tie only when the policy asks it to', async () => {
    const tied = ['task', 'test']
    await expect(suggestClosest('tesk', tied, commandPolicy)).resolves.toBeUndefined()
    await expect(suggestClosest('tesk', tied, flagPolicy)).resolves.toBe('task')
  })
})
