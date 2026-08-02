import process from 'node:process'
import { stripVTControlCharacters, styleText } from 'node:util'

import { describe, expect, it } from 'vitest'

process.env.FORCE_COLOR = '3'

const { highlightJson } = await import('../../../src/utils/json-highlight')

describe('highlightJson', () => {
  const json = JSON.stringify({ name: 'db:seed', count: 3, ok: true, missing: null, list: [1, 'two'] }, null, 2)

  it('colours keys, strings, numbers, booleans and null', () => {
    const highlighted = highlightJson(json)

    expect(highlighted).toContain(`${styleText('blue', '"name"')}: ${styleText('green', '"db:seed"')}`)
    expect(highlighted).toContain(styleText('magenta', '3'))
    expect(highlighted).toContain(styleText('yellow', 'true'))
    expect(highlighted).toContain(styleText('dim', 'null'))
  })

  it('leaves the document parseable', () => {
    expect(JSON.parse(stripVTControlCharacters(highlightJson(json)))).toEqual(JSON.parse(json))
  })

  it('does not colour inside strings that look like tokens', () => {
    expect(highlightJson('{\n  "a": "true 12 null"\n}')).toBe(`{\n  ${styleText('blue', '"a"')}: ${styleText('green', '"true 12 null"')}\n}`)
  })
})
