/**
 * Fill the marker blocks in `docs/` from the citty argument definitions.
 *
 * Each command page wraps its usage line, argument table and option table in
 * `<!--<id>-cmd-->`, `<!--<id>-args-->` and `<!--<id>-opts-->` comments. Only
 * the contents of those blocks are rewritten.
 *
 * Run with `--check` to fail instead of writing, printing the drift.
 */

import { existsSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

/** The subset of citty's `ArgDef` this script reads. */
interface ArgDef {
  type?: 'string' | 'boolean' | 'positional' | 'enum'
  description?: string
  negativeDescription?: string
  valueHint?: string
  alias?: string | string[]
  default?: unknown
  required?: boolean
  multiple?: boolean
  inherit?: boolean
  hidden?: boolean
  options?: string[]
}

type ArgsDef = Record<string, ArgDef>

interface CommandDef {
  meta?: Resolvable<{ name?: string, description?: string } | undefined>
  args?: Resolvable<ArgsDef | undefined>
  subCommands?: Resolvable<Record<string, Resolvable<CommandDef>> | undefined>
}

type Resolvable<T> = T | (() => T | Promise<T>)

interface DocEntry {
  /** Marker id used in the page, e.g. `module-add` for `<!--module-add-opts-->`. */
  id: string
  file: string
  /** Path to the command within the CLI, e.g. `['module', 'add']`. */
  command: string[]
  /** Which CLI the command belongs to. */
  cli?: 'nuxt' | 'create-nuxt'
  /** Overrides the `npx nuxt <command>` prefix of the usage line. */
  usage?: string
}

/**
 * Marker ids are deliberately stable: they are also used on the `3.x` branch,
 * and renaming one would silently orphan a block.
 *
 * `build-module.md` is absent: `nuxt build-module` is not a registered command,
 * it resolves the `@nuxt/module-builder` binary through the `nuxt-<command>`
 * fallback, so its flags are declared in another repository.
 */
const DOCS: DocEntry[] = [
  { id: 'add', file: 'add.md', command: ['add'] },
  { id: 'add-template', file: 'add-template.md', command: ['add-template'] },
  { id: 'analyze', file: 'analyze.md', command: ['analyze'] },
  { id: 'build', file: 'build.md', command: ['build'] },
  { id: 'cleanup', file: 'cleanup.md', command: ['cleanup'] },
  { id: 'curl', file: 'curl.md', command: ['curl'] },
  { id: 'dev', file: 'dev.md', command: ['dev'] },
  { id: 'devtools', file: 'devtools.md', command: ['devtools'] },
  { id: 'docs', file: 'docs.md', command: ['docs'] },
  { id: 'generate', file: 'generate.md', command: ['generate'] },
  { id: 'info', file: 'info.md', command: ['info'] },
  { id: 'init', file: 'init.md', command: [], cli: 'create-nuxt', usage: 'npm create nuxt@latest' },
  { id: 'module-add', file: 'module.md', command: ['module', 'add'] },
  { id: 'module-remove', file: 'module.md', command: ['module', 'remove'] },
  { id: 'module-search', file: 'module.md', command: ['module', 'search'] },
  { id: 'prepare', file: 'prepare.md', command: ['prepare'] },
  { id: 'preview', file: 'preview.md', command: ['preview'] },
  { id: 'task-list', file: 'task.md', command: ['task', 'list'] },
  { id: 'task-run', file: 'task.md', command: ['task', 'run'] },
  { id: 'test', file: 'test.md', command: ['test'] },
  { id: 'typecheck', file: 'typecheck.md', command: ['typecheck'] },
  { id: 'upgrade', file: 'upgrade.md', command: ['upgrade'] },
]

/**
 * Arguments whose default is decided at runtime rather than declared.
 *
 * `nuxt dev --fork` is on wherever the runtime can fork and off where it cannot
 * (Bun without fork support), so printing whichever value this machine resolved
 * would document one platform as if it were all of them.
 */
const RUNTIME_DEFAULTS = new Set(['dev.fork'])

const docsDir = new URL('../docs/', import.meta.url)

async function resolveLazy<T>(value: Resolvable<T>): Promise<T> {
  return typeof value === 'function' ? (value as () => T | Promise<T>)() : value
}

async function loadCli(name: 'nuxt' | 'create-nuxt'): Promise<CommandDef> {
  const pkg = name === 'nuxt' ? 'nuxt-cli' : 'create-nuxt'
  const entry = new URL(`../packages/${pkg}/dist/index.mjs`, import.meta.url)
  const module = await import(pathToFileURL(entry.pathname).href).catch(() => {
    throw new Error(`Could not import ${pkg}. Run \`pnpm build\` first.`)
  }) as { main: CommandDef }
  return module.main
}

async function resolveCommand(root: CommandDef, path: string[]): Promise<CommandDef> {
  let command = root
  for (const segment of path) {
    const subCommands = await resolveLazy(command.subCommands)
    const next = subCommands?.[segment]
    if (!next) {
      throw new Error(`Unknown command \`${path.join(' ')}\``)
    }
    command = await resolveLazy(next)
  }
  return command
}

function aliases(arg: ArgDef): string[] {
  return typeof arg.alias === 'string' ? [arg.alias] : arg.alias ?? []
}

function escapeCell(value: string): string {
  return value.replaceAll('|', '\\|')
}

function code(value: string): string {
  return `\`${escapeCell(value)}\``
}

/** `-p, --port=<port>`, without escaping, for reuse in the usage line. */
function flagSignature(name: string, arg: ArgDef): string {
  const prefixes = [...aliases(arg).map(alias => `-${alias}`), `--${name}`]
  const hint = arg.valueHint ?? arg.options?.join('|')
  const value = hint ? `=<${hint}>${arg.multiple ? '...' : ''}` : ''
  return `${prefixes.join(', ')}${value}`
}

function positionalSignature(name: string, arg: ArgDef): string {
  const label = name.toUpperCase()
  return arg.multiple ? `${label}...` : label
}

function renderDefault(id: string, name: string, arg: ArgDef): string {
  if (RUNTIME_DEFAULTS.has(`${id}.${name}`)) {
    return 'runtime-dependent'
  }
  if (arg.default === undefined || arg.default === null) {
    return ''
  }
  return code(typeof arg.default === 'string' ? arg.default : String(arg.default))
}

function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map(row => row[column]!.length)),
  )
  const line = (cells: string[]) => `| ${cells.map((cell, column) => cell.padEnd(widths[column]!)).join(' | ')} |`
  return [
    line(headers),
    `|${widths.map(width => '-'.repeat(width + 2)).join('|')}|`,
    ...rows.map(line),
  ].join('\n')
}

interface Blocks {
  cmd: string
  args?: string
  opts?: string
}

function render(entry: DocEntry, args: ArgsDef, inherited: ArgsDef): Blocks {
  const visible = Object.entries(args).filter(([, arg]) => !arg.hidden)
  const positionals = visible.filter(([, arg]) => arg.type === 'positional')
  const options = [
    ...Object.entries(inherited).filter(([name]) => !(name in args)),
    ...visible.filter(([, arg]) => arg.type !== 'positional'),
  ]

  const usage = [
    entry.usage ?? ['npx nuxt', ...entry.command].join(' '),
    ...positionals.map(([name, arg]) => {
      const signature = positionalSignature(name, arg)
      return arg.required === false || arg.default !== undefined ? `[${signature}]` : `<${signature}>`
    }),
    ...options.map(([name, arg]) => `[${flagSignature(name, arg)}]`),
  ].join(' ')

  const argRows = positionals.map(([name, arg]) => {
    const signature = positionalSignature(name, arg)
    const hint = arg.valueHint ?? arg.options?.join('|')
    const label = hint
      ? `${signature}=<${hint}>`
      : typeof arg.default === 'string' ? `${signature}="${arg.default}"` : signature
    return [code(label), escapeCell(arg.description ?? '')]
  })

  const optionRows = options.flatMap(([name, arg]) => {
    const rows = [[
      code(flagSignature(name, arg)),
      renderDefault(entry.id, name, arg),
      escapeCell(arg.description ?? ''),
    ]]
    if (arg.negativeDescription) {
      rows.push([code(`--no-${name}`), '', escapeCell(arg.negativeDescription)])
    }
    return rows
  })

  return {
    cmd: `\`\`\`bash [Terminal]\n${usage}\n\`\`\``,
    args: argRows.length > 0 ? renderTable(['Argument', 'Description'], argRows) : undefined,
    opts: optionRows.length > 0 ? renderTable(['Option', 'Default', 'Description'], optionRows) : undefined,
  }
}

function replaceBlock(source: string, marker: string, body: string | undefined, file: string): string {
  const open = `<!--${marker}-->`
  const close = `<!--/${marker}-->`
  const start = source.indexOf(open)
  if (start === -1) {
    if (body !== undefined) {
      throw new Error(`${file}: missing \`${open}\` block`)
    }
    return source
  }
  const end = source.indexOf(close, start)
  if (end === -1) {
    throw new Error(`${file}: \`${open}\` is never closed`)
  }
  if (body === undefined) {
    throw new Error(`${file}: \`${open}\` has nothing to generate into it`)
  }
  return `${source.slice(0, start + open.length)}\n${body}\n${source.slice(end)}`
}

function diff(before: string, after: string, file: string): string {
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')
  const lines: string[] = [`--- a/docs/${file}`, `+++ b/docs/${file}`]
  for (let index = 0; index < Math.max(beforeLines.length, afterLines.length); index++) {
    if (beforeLines[index] === afterLines[index]) {
      continue
    }
    if (beforeLines[index] !== undefined) {
      lines.push(`-${beforeLines[index]}`)
    }
    if (afterLines[index] !== undefined) {
      lines.push(`+${afterLines[index]}`)
    }
  }
  return lines.join('\n')
}

/**
 * Check the hand-written paths a page can get wrong without anything failing.
 *
 * The `Source` link in each page's frontmatter is hand-written, and a package or
 * command rename silently turns it into a 404. Image sources are repo-root paths
 * that nuxt.com rewrites to the branch it is serving, so a capture that is
 * renamed or never recorded resolves to nothing at all. Neither is generated:
 * rewriting either would put this script in charge of content outside the
 * marker blocks.
 */
async function checkPaths(): Promise<string[]> {
  const problems: string[] = []
  for (const file of (await readdir(docsDir)).filter(name => name.endsWith('.md'))) {
    const source = await readFile(new URL(file, docsDir), 'utf8')
    for (const [, path] of source.matchAll(/to: https:\/\/github\.com\/nuxt\/cli\/(?:blob|tree)\/main\/(\S+)/g)) {
      if (!existsSync(new URL(`../${path}`, import.meta.url))) {
        problems.push(`docs/${file}: source link points at missing \`${path}\``)
      }
    }
    for (const [, src] of source.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
      if (!src!.startsWith('/')) {
        problems.push(`docs/${file}: image \`${src}\` is not a path from the repository root`)
      }
      else if (!existsSync(new URL(`..${src}`, import.meta.url))) {
        problems.push(`docs/${file}: image points at missing \`${src}\``)
      }
    }
  }
  return problems
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check')

  const clis = {
    'nuxt': await loadCli('nuxt'),
    'create-nuxt': await loadCli('create-nuxt'),
  }
  const rootArgs = await resolveLazy(clis.nuxt.args) ?? {}
  const inherited = Object.fromEntries(Object.entries(rootArgs).filter(([, arg]) => arg.inherit))

  const pages = new Map<string, string>()
  for (const entry of DOCS) {
    const root = clis[entry.cli ?? 'nuxt']
    const command = await resolveCommand(root, entry.command)
    const args = await resolveLazy(command.args) ?? {}
    const blocks = render(entry, args, entry.cli === 'create-nuxt' ? {} : inherited)

    const source = pages.get(entry.file) ?? await readFile(new URL(entry.file, docsDir), 'utf8')
    let updated = replaceBlock(source, `${entry.id}-cmd`, blocks.cmd, entry.file)
    updated = replaceBlock(updated, `${entry.id}-args`, blocks.args, entry.file)
    updated = replaceBlock(updated, `${entry.id}-opts`, blocks.opts, entry.file)
    pages.set(entry.file, updated)
  }

  const drifted: string[] = []
  for (const [file, updated] of pages) {
    const url = new URL(file, docsDir)
    const current = await readFile(url, 'utf8')
    if (current === updated) {
      continue
    }
    if (check) {
      drifted.push(diff(current, updated, file))
      continue
    }
    await writeFile(url, updated, 'utf8')
    console.log(`updated docs/${file}`)
  }

  if (drifted.length > 0) {
    console.error(`Command documentation is out of date. Run \`pnpm docs:generate\`.\n\n${drifted.join('\n\n')}`)
    process.exitCode = 1
  }

  const brokenPaths = await checkPaths()
  if (brokenPaths.length > 0) {
    console.error(brokenPaths.join('\n'))
    process.exitCode = 1
  }
}

await main().catch((error) => {
  console.error(`generate-command-docs: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
