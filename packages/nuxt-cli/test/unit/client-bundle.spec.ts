import type { ClientFile } from '../../src/utils/client-bundle'

import { describe, expect, it } from 'vitest'

import { formatClientBundle, readClientBundle, summariseClientBundle } from '../../src/utils/client-bundle'
import { stripAnsi } from '../../src/utils/formatting'

const root = '/app'
const pnpm = (name: string, version: string, file = 'dist/index.js') => `/app/node_modules/.pnpm/${name.replace('/', '+')}@${version}/node_modules/${name}/${file}`

function js(fileName: string, options: Partial<ClientFile> & { modules?: ClientFile['modules'] }): ClientFile {
  const size = options.size ?? options.modules?.reduce((sum, module) => sum + module.size, 0) ?? 0
  return { kind: 'js', gzip: Math.round(size / 3), isEntry: false, isDynamicEntry: false, imports: [], dynamicImports: [], css: [], modules: [], size, fileName, ...options }
}

const css = (fileName: string, size: number): ClientFile => ({ fileName, kind: 'css', size, gzip: size / 4, isEntry: false, isDynamicEntry: false, imports: [], dynamicImports: [], css: [], modules: [] })

describe('client bundle summary', () => {
  const files = [
    js('_nuxt/entry.js', {
      isEntry: true,
      imports: ['_nuxt/vendor.js'],
      dynamicImports: ['_nuxt/editor.js'],
      css: ['_nuxt/entry.css'],
      modules: [
        { id: '/app/app/app.vue?vue&type=script&setup=true&lang.ts', size: 2_000, importers: [] },
        { id: pnpm('chart.js', '4.0.0'), size: 60_000, importers: ['/app/app/app.vue?vue&type=script&setup=true&lang.ts'] },
        { id: pnpm('semver', '7.0.0'), size: 10_000, importers: ['/app/app/app.vue'] },
        { id: '\0vite/preload-helper.js', size: 500, importers: [] },
      ],
    }),
    js('_nuxt/vendor.js', { modules: [{ id: pnpm('@vue/runtime-core', '3.5.0', 'dist/runtime-core.esm-bundler.js'), size: 70_000, importers: [] }] }),
    js('_nuxt/editor.js', {
      isDynamicEntry: true,
      source: '/app/app/components/Editor.vue',
      imports: ['_nuxt/entry.js'],
      modules: [
        { id: '/app/app/components/Editor.vue', size: 1_000, importers: [] },
        { id: pnpm('monaco-editor', '0.50.0'), size: 200_000, importers: ['/app/app/components/Editor.vue'] },
        // A dependency's own copy, nested under the package that needs it.
        { id: `${pnpm('legacy', '1.0.0').replace('/dist/index.js', '')}/node_modules/semver/index.js`, size: 8_000, importers: [pnpm('legacy', '1.0.0')] },
      ],
    }),
    css('_nuxt/entry.css', 3_000),
    css('_nuxt/editor.css', 1_000),
  ]
  const versions: Record<string, string> = {
    [pnpm('semver', '7.0.0').replace('/dist/index.js', '')]: '7.0.0',
    [`${pnpm('legacy', '1.0.0').replace('/dist/index.js', '')}/node_modules/semver`]: '6.3.1',
  }
  const summary = summariseClientBundle(files, root, dir => versions[dir])

  it('counts what every page loads: the entry, its static imports and their CSS, not lazy chunks', () => {
    expect(summary.initial.size).toBe(72_500 + 70_000 + 3_000)
    expect(summary.js).toMatchObject({ files: 3, size: 72_500 + 70_000 + 209_000 })
    expect(summary.css).toMatchObject({ files: 2, size: 4_000 })
  })

  it('attributes modules to packages, the app, and virtual modules', () => {
    const groups = Object.fromEntries(summary.groups.map(group => [group.name, group]))
    expect(Object.keys(groups)).toEqual(['monaco-editor', '@vue/runtime-core', 'chart.js', 'semver', 'your app', 'virtual modules'])
    expect(groups.semver).toMatchObject({ size: 18_000, initial: 10_000 })
    expect(groups['your app']).toMatchObject({ kind: 'app', size: 3_000 })
    expect(groups['chart.js']!.importedBy).toEqual(['app/app.vue'])
  })

  it('describes each chunk by what loads it and what it is made of', () => {
    expect(summary.chunks.map(chunk => [chunk.fileName, chunk.role, chunk.detail, chunk.contents[0]])).toEqual([
      ['_nuxt/editor.js', 'lazy', 'app/components/Editor.vue', 'monaco-editor'],
      ['_nuxt/entry.js', 'entry', undefined, 'chart.js'],
      ['_nuxt/vendor.js', 'initial', undefined, '@vue/runtime-core'],
    ])
  })

  it('reports each copy of a duplicated package with what imports it', () => {
    expect(summary.duplicates).toEqual([{
      name: 'semver',
      copies: [{ version: '7.0.0', importedBy: ['app/app.vue'] }, { version: '6.3.1', importedBy: ['legacy'] }],
    }])
  })

  it('hints at duplicates and at heavy packages on every page, but not at the framework or lazy chunks', () => {
    const output = stripAnsi(formatClientBundle(summary, 200))
    const hints = output.split('\n').filter(line => line.startsWith('! '))
    expect(hints).toEqual([
      '! semver is bundled 2 times: 7.0.0 via app/app.vue, 6.3.1 via legacy. Deduplicate it in your lockfile.',
      '! chart.js adds 60.00 kB to every page via app/app.vue. Import it only where needed, or lazy load the component using it.',
    ])
  })

  it('points the analyzer at the project when it is not the current directory', () => {
    const footer = (projectDir?: string) => stripAnsi(formatClientBundle(summary, 200, projectDir)).split('\n').at(-1)
    expect(footer()).toBe('See what each chunk imports with npx nuxt-bundle-analyzer')
    expect(footer('playground')).toBe('See what each chunk imports with npx nuxt-bundle-analyzer playground')
    expect(footer('my app')).toBe('See what each chunk imports with npx nuxt-bundle-analyzer "my app"')
  })

  it('fills each package bar by its share of the whole bundle, CSS included', () => {
    const output = stripAnsi(formatClientBundle(summary, 200))
    // 200 kB of 351.5 kB JS + 4 kB CSS: the largest package is not a full bar.
    expect(output).toMatch(/^monaco-editor .* █{11}░{9} +56%$/m)
  })

  it('cuts table rows to the terminal width, and leaves sentences to wrap', () => {
    const lines = stripAnsi(formatClientBundle(summary, 40)).split('\n').filter(line => !line.startsWith('! ') && !line.startsWith('See what'))
    expect(Math.max(...lines.map(line => line.length))).toBeLessThanOrEqual(40)
  })
})

describe('reading the bundle', () => {
  it('spreads a chunk\'s final size over its modules by their share before minification', () => {
    const [file] = readClientBundle({
      'a.js': {
        type: 'chunk',
        fileName: 'a.js',
        code: 'x'.repeat(100),
        isEntry: true,
        isDynamicEntry: false,
        facadeModuleId: null,
        imports: [],
        dynamicImports: [],
        modules: { a: { renderedLength: 300 }, b: { renderedLength: 100 }, c: { renderedLength: 0 } },
      },
    })
    expect(file!.modules.map(module => [module.id, module.size])).toEqual([['a', 75], ['b', 25], ['c', 0]])
  })
})
