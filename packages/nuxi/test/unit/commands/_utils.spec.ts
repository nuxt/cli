import { describe, expect, it } from 'vitest'
import { isNuxiCommand, nuxiCommands } from '../../../src/commands/_utils'

describe('isNuxiCommand', () => {
  it('should return true for valid nuxi commands', () => {
    nuxiCommands.forEach((command) => {
      expect(isNuxiCommand(command)).toBe(true)
    })
  })

  it('should return false for invalid nuxi commands', () => {
    const invalidCommands = [
      '',
      ' ',
      'devv',
      'Dev',
      'BuilD',
      'random',
      'nuxi',
      'install',
      undefined,
      null,
    ]

    invalidCommands.forEach((command) => {
      expect(isNuxiCommand(command as string)).toBe(false)
    })
  })
})
