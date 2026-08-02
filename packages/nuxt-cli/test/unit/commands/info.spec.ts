import { describe, expect, it } from 'vitest'

import { formatMarkdownTable, getPackageName, normalizeConfigModule } from '../../../src/commands/info'

describe('info', () => {
  describe('formatMarkdownTable', () => {
    it('includes rows in minimal environments', () => {
      expect(formatMarkdownTable({
        'Nuxt version': '4.0.0',
        'Modules': '`@nuxt/image@1.0.0`',
        'Config': '',
      })).toMatchInlineSnapshot(`
        "|                  |                     |
        | ---------------- | ------------------- |
        | **Nuxt version** | \`4.0.0\`             |
        | **Modules**      | \`@nuxt/image@1.0.0\` |
        | **Config**       | \`-\`                 |
        "
      `)
    })
  })

  describe('getPackageName', () => {
    it.each([
      ['@nuxt/image', '@nuxt/image'],
      ['@nuxt/image/module', '@nuxt/image'],
      ['example/module', 'example'],
      ['example', 'example'],
      ['./modules/example', undefined],
      ['/project/modules/example', undefined],
      ['C:\\project\\modules\\example', undefined],
      ['exampleModule()', undefined],
    ])('gets the package name for %s', (module, expected) => {
      expect(getPackageName(module)).toBe(expected)
    })
  })

  describe('normalizeConfigModule', () => {
    it.each([
      ['/project/modules/example', '/project', 'modules/example'],
      ['/project/node_modules/@nuxt/image/dist/module.mjs', '/project', '@nuxt/image/dist/module.mjs'],
      ['/project/node_modules/foo/node_modules/bar/index.mjs', '/project', 'bar/index.mjs'],
      ['C:\\project\\modules\\example', 'C:\\project', 'modules/example'],
      ['@nuxt/image', '/project', '@nuxt/image'],
    ])('normalizes %s', (module, rootDir, expected) => {
      expect(normalizeConfigModule(module, rootDir)).toBe(expected)
      expect(normalizeConfigModule([module, {}], rootDir)).toBe(expected)
    })

    it('formats function modules', () => {
      function exampleModule() {}
      expect(normalizeConfigModule(exampleModule, '/project')).toBe('exampleModule()')
    })
  })
})
