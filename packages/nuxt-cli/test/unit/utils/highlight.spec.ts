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

  describe('md', () => {
    const md = [
      '# Title',
      '',
      'Some **bold** and `code`.',
      '',
      '```ts [app.ts]',
      'const a = 1',
      '```',
      '',
    ].join('\n')

    it('colours headings, emphasis and inline code', () => {
      const highlighted = highlight(md, 'md')

      expect(highlighted).toContain(styleText('magenta', '# Title'))
      expect(highlighted).toContain(styleText('yellow', '**bold**'))
      expect(highlighted).toContain(styleText('green', '`code`'))
    })

    it('colours a fenced block with the language of its info string', () => {
      expect(highlight(md, 'md')).toContain(styleText('magenta', 'const'))
      expect(highlight('```typescript\nconst a = 1\n```\n', 'md')).toContain(styleText('magenta', 'const'))
    })

    it('colours a vue fence, reading its script block as typescript', () => {
      const highlighted = highlight('```vue [app.vue]\n<script setup lang="ts">\ninterface Props { msg: string }\n</script>\n<style>.a{color:red}</style>\n```\n', 'md')

      expect(highlighted).toContain(styleText('magenta', 'interface'))
      expect(highlighted).toContain(styleText('blue', 'style'))
      expect(highlighted).toContain(styleText('blue', 'color'))
    })

    it.each<[fence: string, token: string, colour: 'cyan' | 'magenta' | 'red']>([
      ['```bash\necho "hi"\n```\n', 'echo', 'cyan'],
      ['```sh\necho "hi"\n```\n', 'echo', 'cyan'],
      ['```diff\n- a\n+ b\n```\n', '- a', 'red'],
      ['```python\ndef a(): pass\n```\n', 'def', 'magenta'],
      ['```http\nGET /x HTTP/1.1\n```\n', 'GET', 'magenta'],
    ])('colours a %j fence', (fence, token, colour) => {
      expect(highlight(fence, 'md')).toContain(styleText(colour, token))
    })

    it('leaves a fence in an unknown language unstyled', () => {
      const highlighted = highlight('```zig\nconst a = 1\n```\n', 'md')

      expect(highlighted).toContain('\nconst a = 1\n')
    })

    it('leaves the document untouched', () => {
      expect(stripVTControlCharacters(highlight(md, 'md'))).toBe(md)
    })
  })
})
