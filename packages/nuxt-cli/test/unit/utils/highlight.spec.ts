import process from 'node:process'
import { stripVTControlCharacters, styleText } from 'node:util'

import { describe, expect, it } from 'vitest'

process.env.FORCE_COLOR = '3'

const { highlight } = await import('../../../src/utils/highlight')

describe('highlight', () => {
  describe('json', () => {
    const json = JSON.stringify({ name: 'db:seed', count: 3, ok: true, missing: null, list: [1, 'two'] }, null, 2)

    it('colours keys, strings, numbers and booleans', () => {
      const highlighted = highlight(json, 'json')

      expect(highlighted).toContain(`${styleText('blue', '"name"')}: ${styleText('green', '"db:seed"')}`)
      expect(highlighted).toContain(styleText('magenta', '3'))
      expect(highlighted).toContain(styleText('yellow', 'true'))
      expect(highlighted).toContain(styleText('magenta', 'null'))
    })

    it('leaves the document parseable', () => {
      expect(JSON.parse(stripVTControlCharacters(highlight(json, 'json')))).toEqual(JSON.parse(json))
    })

    it('does not colour inside strings that look like tokens', () => {
      expect(highlight('{\n  "a": "true 12 null"\n}', 'json')).toBe(`{\n  ${styleText('blue', '"a"')}: ${styleText('green', '"true 12 null"')}\n}`)
    })
  })

  describe('html', () => {
    const html = '<!DOCTYPE html>\n<div id="app" class="x">\n  <!-- hi -->\n  <span>text</span>\n</div>\n'

    it('colours tags, attributes and comments', () => {
      const highlighted = highlight(html, 'html')

      expect(highlighted).toContain(styleText('blue', 'div'))
      expect(highlighted).toContain(styleText('yellow', 'id'))
      expect(highlighted).toContain(styleText('green', '"app"'))
      expect(highlighted).toContain(styleText('gray', '<!-- hi -->'))
    })

    it('colours embedded script and style contents', () => {
      const highlighted = highlight('<style>a{color:red}</style><script>const a = 1</script>', 'html')

      expect(highlighted).toContain(styleText('magenta', 'const'))
      expect(highlighted).toContain(styleText('blue', 'color'))
    })

    it('leaves the document untouched', () => {
      expect(stripVTControlCharacters(highlight(html, 'html'))).toBe(html)
    })
  })
})
