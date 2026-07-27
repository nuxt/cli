import { describe, expect, it } from 'vitest'

import { getHeadlessCommand, getInvocationPrefix, isPinnedCreateInvocation, wrapCommand } from '../../../src/utils/headless'

describe('getInvocationPrefix', () => {
  it('should suggest the package manager create command', () => {
    expect(getInvocationPrefix(['node', '/tmp/x/create-nuxt.mjs'], 'pnpm/9.0.0 npm/? node/v22')).toBe('pnpm create nuxt@latest')
  })

  it('should fall back to npm for an unknown package manager', () => {
    expect(getInvocationPrefix(['node', '/tmp/x/create-nuxt-app.mjs'], 'ni/1.0.0')).toBe('npm create nuxt@latest')
  })

  it('should use the nuxt subcommand for the nuxt cli', () => {
    expect(getInvocationPrefix(['node', '/tmp/x/nuxi.mjs'], 'npm/10.0.0')).toBe('nuxt init')
  })
})

describe('getHeadlessCommand', () => {
  const base = { prefix: 'nuxt init', dir: 'my-app', template: 'minimal', packageManager: 'pnpm' as const, gitInit: true, install: true, windows: false }

  it('should include every prompted argument', () => {
    expect(getHeadlessCommand(base).join(' ')).toBe('nuxt init my-app --template=minimal --packageManager=pnpm --gitInit --no-modules')
  })

  it('should negate declined options', () => {
    expect(getHeadlessCommand({ ...base, gitInit: false, install: false }).join(' ')).toBe('nuxt init my-app --template=minimal --packageManager=pnpm --no-gitInit --no-modules --no-install')
  })

  it('should list selected modules and quote a directory with spaces', () => {
    expect(getHeadlessCommand({ ...base, dir: 'my app', modules: ['@nuxt/ui', '@nuxt/image'], force: true }).join(' ')).toBe('nuxt init \'my app\' --template=minimal --packageManager=pnpm --gitInit --modules=@nuxt/ui,@nuxt/image --force')
  })

  it('should carry the nightly channel through', () => {
    expect(getHeadlessCommand({ ...base, nightly: 'latest' }).join(' ')).toContain('--nightly=latest')
  })

  it('should quote so the shell cannot expand the directory', () => {
    expect(getHeadlessCommand({ ...base, dir: 'my $app' })[1]).toBe(`'my $app'`)
    expect(getHeadlessCommand({ ...base, dir: `it's mine` })[1]).toBe(`'it'\\''s mine'`)
    expect(getHeadlessCommand({ ...base, dir: 'my $app', windows: true })[1]).toBe('"my $app"')
  })

  it('should double the backslashes windows would read as escaping a quote', () => {
    const quote = (dir: string) => getHeadlessCommand({ ...base, dir, windows: true })[1]
    expect(quote('my dir\\')).toBe('"my dir\\\\"')
    expect(quote('a\\"b')).toBe('"a\\\\\\"b"')
    // Backslashes away from a quote are literal and must be left alone.
    expect(quote('a\\b c')).toBe('"a\\b c"')
  })
})

describe('wrapCommand', () => {
  const tokens = ['pnpm create nuxt', 'my-app', '--template=minimal', '--packageManager=pnpm', '--no-gitInit', '--no-modules']

  it('should leave a command that fits on one line', () => {
    expect(wrapCommand(tokens, { width: 120, windows: false })).toEqual([tokens.join(' ')])
  })

  it('should wrap on argument boundaries within the given width', () => {
    const lines = wrapCommand(tokens, { width: 50, windows: false })
    expect(lines).toEqual([
      'pnpm create nuxt my-app --template=minimal \\',
      '  --packageManager=pnpm --no-gitInit \\',
      '  --no-modules',
    ])
    expect(Math.max(...lines.map(line => line.length))).toBeLessThanOrEqual(50)
  })

  it('should use the continuation marker of the likely shell', () => {
    expect(wrapCommand(tokens, { width: 40, windows: true, env: { PSModulePath: 'C:\\Modules' } })[0]).toMatch(/`$/)
    expect(wrapCommand(tokens, { width: 40, windows: true, env: {} })[0]).toMatch(/\^$/)
    expect(wrapCommand(tokens, { width: 40, windows: true, env: { MSYSTEM: 'MINGW64' } })[0]).toMatch(/\\$/)
  })

  it('should not split a token longer than the width', () => {
    expect(wrapCommand(['nuxt init', '--modules=@nuxt/ui,@nuxt/image,@nuxt/content'], { width: 20, windows: false })).toEqual([
      'nuxt init \\',
      '  --modules=@nuxt/ui,@nuxt/image,@nuxt/content',
    ])
  })
})

describe('isPinnedCreateInvocation', () => {
  it.each([
    'pnpm create nuxt@latest my-app',
    'npm create nuxt@latest',
    'npx create-nuxt@4.2.0',
    'bun create nuxt-app@latest',
  ])('should detect a pinned invocation (%s)', (command) => {
    expect(isPinnedCreateInvocation([command])).toBe(true)
  })

  it.each([
    'pnpm create nuxt my-app',
    'npx create-nuxt',
    'node /path/to/create-nuxt.mjs',
  ])('should not treat an unpinned invocation as pinned (%s)', (command) => {
    expect(isPinnedCreateInvocation([command])).toBe(false)
  })

  it('should find the invocation further up the process tree', () => {
    expect(isPinnedCreateInvocation(['node /npx/create-nuxt', 'npm exec create-nuxt@latest', '-zsh'])).toBe(true)
  })

  it('should assume nothing was pinned when the process tree is unavailable', () => {
    expect(isPinnedCreateInvocation([])).toBe(false)
  })
})
