import type { Capture } from './captures.config.ts'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { captures, NEEDS_DEV_SERVER } from './captures.config.ts'
import { buildFingerprint, buildFrames } from './lib/frames.ts'
import { record } from './lib/pty.ts'
import { describeRules } from './lib/scrub.ts'
import { toSvg } from './lib/svg.ts'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

process.env.NUXT_TELEMETRY_DISABLED = '1'

/** Environmental noise pinned in the fingerprint but kept real in the SVG. */
const FINGERPRINT_RULES = ['versions', 'timings', 'dates', 'spinner']

const { values } = parseArgs({
  options: {
    'only': { type: 'string', multiple: true, default: [] },
    'bin': { type: 'string', default: join(repoRoot, 'packages/nuxt-cli/bin/nuxi.mjs') },
    'workdir': { type: 'string', default: join(homedir(), '.cache', 'nuxt-cli-capture') },
    'out': { type: 'string', default: join(repoRoot, 'capture/output') },
    'columns': { type: 'string', default: '96' },
    'no-scrub': { type: 'boolean', default: false },
    'force': { type: 'boolean', default: false },
  },
})

const workdir = values.workdir!
const appDir = join(workdir, 'app')
const scratchDir = join(workdir, 'scratch')
mkdirSync(values.out!, { recursive: true })
mkdirSync(scratchDir, { recursive: true })

/** Caches that live in the work directory but are not fixture-managed. */
const PRESERVED_DIRS = new Set(['node_modules', '.nuxt', '.output', '.data'])

const changedFixtureFiles = syncFixture(join(repoRoot, 'capture/fixture'), appDir)
if (!existsSync(join(appDir, 'node_modules/nuxt')) || changedFixtureFiles.includes('package-lock.json')) {
  console.log('installing capture fixture dependencies')
  execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: appDir, stdio: 'inherit' })
}

/**
 * Mirror the fixture into the work directory, returning the changed paths.
 * Only files whose content actually changed are rewritten: a blanket copy
 * touches every config file's mtime and invalidates Vite's dependency cache,
 * putting a "Re-optimizing dependencies" line into the next recording. Files
 * deleted from the fixture are removed so stale routes or handlers cannot
 * leak into a capture.
 */
function syncFixture(from: string, to: string): string[] {
  const changed: string[] = []
  const sourceEntries = readdirSync(from, { recursive: true, encoding: 'utf8' })
  const sourceFiles = new Set(sourceEntries)
  for (const entry of sourceEntries) {
    const source = join(from, entry)
    if (statSync(source).isDirectory()) {
      continue
    }
    const target = join(to, entry)
    const content = readFileSync(source)
    let unchanged = false
    try {
      unchanged = readFileSync(target).equals(content)
    }
    catch {}
    if (!unchanged) {
      mkdirSync(join(target, '..'), { recursive: true })
      writeFileSync(target, content)
      changed.push(entry)
    }
  }
  for (const entry of readdirSync(to, { recursive: true, encoding: 'utf8' })) {
    if (PRESERVED_DIRS.has(entry.split('/')[0]!)) {
      continue
    }
    const target = join(to, entry)
    if (!sourceFiles.has(entry) && !statSync(target).isDirectory()) {
      rmSync(target)
      changed.push(entry)
    }
  }
  return changed
}

const selected = values.only!.length ? captures.filter(capture => values.only!.includes(capture.id)) : captures
const unknown = values.only!.filter(id => !captures.some(capture => capture.id === id))
if (unknown.length) {
  console.error(`unknown scenario id(s): ${unknown.join(', ')}\nknown ids: ${captures.map(capture => capture.id).join(', ')}`)
  process.exit(1)
}

/**
 * A throwaway dev run so that one-time startup work (Vite dependency
 * optimisation after a fixture or CLI change, `.nuxt` priming) happens off
 * camera and recorded runs start clean.
 */
async function warmUpFixture(): Promise<void> {
  console.log('warming up the fixture app')
  const session = record(`node ${values.bin} dev --no-clear --takeover --port 3000`, { cwd: appDir, columns: 120, rows: 40 })
  try {
    await session.waitFor(/warmed up|Vite client built/, 240_000)
    await session.wait(500)
  }
  finally {
    await session.stop()
  }
}

let devServer: import('./lib/pty.ts').PtySession | undefined
async function ensureDevServer(): Promise<void> {
  if (devServer) {
    return
  }
  devServer = record(`node ${values.bin} dev --no-clear --takeover --port 3000`, { cwd: appDir, columns: 120, rows: 40 })
  await devServer.waitFor(/warmed up|Vite client built/, 240_000)
  await devServer.wait(1500)
}

async function runCapture(capture: Capture): Promise<void> {
  const columns = capture.columns ?? Number(values.columns)
  const rows = capture.rows ?? 24
  const cwd = capture.cwd === 'scratch' ? scratchDir : appDir
  if (capture.cwd === 'scratch') {
    rmSync(scratchDir, { recursive: true, force: true })
    mkdirSync(scratchDir, { recursive: true })
  }
  if (NEEDS_DEV_SERVER.has(capture.id)) {
    await ensureDevServer()
  }

  const command = capture.command
    .replaceAll('$NUXT', `node ${values.bin}`)
    .replaceAll('$CREATE_NUXT', `node ${join(repoRoot, 'packages/create-nuxt/bin/create-nuxt.mjs')}`)
  const session = record(command, {
    cwd,
    columns,
    rows,
    env: capture.env,
  })

  // Whatever happens, the session must not outlive its capture: a leaked dev
  // server holds the fixture's lock and port and poisons every later scenario.
  try {
    if (capture.drive) {
      await capture.drive({ session, cwd, bin: values.bin! })
    }
    if (!capture.stopAfterDrive) {
      let timer: NodeJS.Timeout | undefined
      const timedOut = new Promise<{ timedOut: true, code: null }>((resolve) => {
        timer = setTimeout(resolve, 240_000, { timedOut: true, code: null })
      })
      const result = await Promise.race([
        session.exited.then(code => ({ timedOut: false, code })),
        timedOut,
      ])
      clearTimeout(timer)
      if (result.timedOut) {
        throw new Error(`${capture.id} timed out after 240 seconds, saw:\n${session.output().slice(-1500)}`)
      }
      if (result.code !== 0) {
        throw new Error(`${capture.id} exited with ${result.code}, saw:\n${session.output().slice(-1500)}`)
      }
    }
  }
  finally {
    await session.stop()
  }

  if (process.env.CAPTURE_DEBUG) {
    console.log(JSON.stringify(session.output().slice(0, 4000)))
  }
  if (/is in use, using port/.test(session.output())) {
    console.warn(`[capture] ${capture.id}: another server occupied the preferred port during recording; the capture contains a "port in use" warning. Re-record on a quiet machine.`)
  }
  const scrubRules = values['no-scrub'] ? [] : (capture.scrub ?? [])
  const target = join(values.out!, `${capture.id}.svg`)

  // The fingerprint decides whether the committed SVG is stale. It pins
  // everything environmental (timings, versions, spinner phase, dates) that
  // the SVG deliberately keeps real, so a re-recording only replaces the SVG
  // when the CLI's actual content changed.
  if (!values['no-scrub']) {
    const fingerprintRules = [...new Set([...scrubRules, ...FINGERPRINT_RULES])]
    const fingerprint = buildFingerprint(session.chunks, { rows, scrubRules: fingerprintRules })
    const fingerprintTarget = join(values.out!, `${capture.id}.txt`)
    let existing: string | undefined
    try {
      existing = readFileSync(fingerprintTarget, 'utf8')
    }
    catch {}
    if (!values.force && existing === fingerprint && existsSync(target)) {
      console.log(`${capture.id}: content unchanged, keeping the committed SVG`)
      return
    }
    writeFileSync(fingerprintTarget, fingerprint)
  }

  const frames = buildFrames(session.chunks, { rows, scrubRules })
  const svg = toSvg(capture.animated ? frames : frames.slice(-1).map(frame => ({ ...frame, at: 0 })), {
    columns,
    rows,
    title: capture.title,
    scrubbed: describeRules(scrubRules),
    animated: !!capture.animated,
  })
  writeFileSync(target, svg)
  console.log(`${capture.id}: ${frames.length} frames, ${(svg.length / 1024).toFixed(1)} kB -> ${target}`)
}

/**
 * Wait for the previous scenario's dev server to actually die, so the next
 * one does not race its takeover handshake against a lock holder that is
 * mid-shutdown.
 */
async function waitForLockRelease(timeoutMs = 15_000): Promise<void> {
  // The shared dev server for the request-driven scenarios legitimately
  // holds the lock for the rest of the run.
  if (devServer) {
    return
  }
  const lockPath = join(appDir, '.nuxt', 'nuxt.lock')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    let pid: number | undefined
    try {
      pid = JSON.parse(readFileSync(lockPath, 'utf8')).pid
    }
    catch {
      return
    }
    try {
      process.kill(pid!, 0)
    }
    catch {
      rmSync(lockPath, { force: true })
      return
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  console.warn(`[capture] a dev server still holds ${lockPath}; the next scenario may refuse to start`)
}

try {
  if (selected.some(capture => capture.command.includes(' dev '))) {
    await warmUpFixture()
  }
  for (const capture of selected) {
    await waitForLockRelease()
    console.log(`recording ${capture.id}`)
    await runCapture(capture)
  }
}
finally {
  await devServer?.stop()
}
process.exit(0)
