import { execFile } from 'node:child_process'
import process from 'node:process'
import { promisify } from 'node:util'

/** The `nuxt info` table for the project in `cwd`, gathered in a separate process. */
export async function readProjectReport(cwd: string): Promise<string> {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [globalThis.__nuxt_cli__!.entry, 'info', '--json', cwd],
    { cwd, timeout: 30_000 },
  )
  const { formatJsonAsMarkdownTable } = await import('../../commands/info')
  return formatJsonAsMarkdownTable(JSON.parse(stdout))
}
