import type { PtySession } from './lib/pty.ts'
import { lstatSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

interface CaptureContext {
  session: PtySession
  /** Directory the capture runs in. */
  cwd: string
  /** Absolute path to `bin/nuxi.mjs` under test. */
  bin: string
}

export interface Capture {
  id: string
  title: string
  /** Shell command run inside the pty. `$NUXT` expands to the CLI entry under test, `$CREATE_NUXT` to the workspace `create-nuxt` bin. */
  command: string
  /** Directory to run in, relative to the capture workdir. */
  cwd?: string
  columns?: number
  rows?: number
  animated?: boolean
  /** Rules from `lib/scrub.ts` applied to the captured bytes. */
  scrub?: string[]
  /** Drives the session: waits, keystrokes, file edits. */
  drive?: (context: CaptureContext) => Promise<void>
  /** Extra environment for the pty. */
  env?: Record<string, string>
  /** Kill the command once `drive` returns rather than waiting for it to exit. */
  stopAfterDrive?: boolean
}

/**
 * Rendering scrubs are privacy and environment only: real timings, versions
 * and spinner phases stay in the SVG so it still reads as a real recording.
 * Whether a re-recording *replaces* a committed SVG is decided separately, by
 * a fingerprint that pins all of those (see `FINGERPRINT_RULES` in record.ts).
 */
const DEFAULT_SCRUB = ['ports', 'hostnames', 'paths']

/** Dev output also shows a QR code encoding the machine's real address. */
const DEV_SCRUB = [...DEFAULT_SCRUB, 'qr']

/**
 * The dev UI decides for itself whether to run based on CI/test heuristics,
 * so each dev capture pins the mode: `NUXT_TUI=1` for the interactive panel,
 * `NUXT_TUI=plain` for the classic log stream.
 */
const TUI_ENV = { NUXT_TUI: '1' }
const PLAIN_ENV = { NUXT_TUI: 'plain' }

export const captures: Capture[] = [
  {
    id: 'nuxt-dev',
    title: 'nuxt dev',
    command: '$NUXT dev --no-clear --takeover',
    cwd: 'app',
    animated: true,
    rows: 26,
    scrub: DEV_SCRUB,
    stopAfterDrive: true,
    env: TUI_ENV,
    async drive({ session }) {
      await session.waitFor(/ready in \d/, 180_000)
      await session.wait(2500)
    },
  },
  {
    id: 'nuxt-dev-static',
    title: 'nuxt dev (ready)',
    command: '$NUXT dev --no-clear --takeover',
    cwd: 'app',
    animated: false,
    rows: 26,
    scrub: DEV_SCRUB,
    stopAfterDrive: true,
    env: TUI_ENV,
    async drive({ session }) {
      await session.waitFor(/ready in \d/, 180_000)
      await session.wait(2000)
    },
  },
  {
    id: 'nuxt-dev-restart',
    title: 'nuxt dev (restart on config change)',
    command: '$NUXT dev --no-clear --takeover',
    cwd: 'app',
    animated: true,
    rows: 26,
    scrub: DEV_SCRUB,
    stopAfterDrive: true,
    env: TUI_ENV,
    async drive({ session, cwd }) {
      const { readFileSync, writeFileSync } = await import('node:fs')
      const { join } = await import('node:path')
      await session.waitFor(/ready in \d/, 180_000)
      await session.wait(1500)
      const config = join(cwd, 'nuxt.config.ts')
      const original = readFileSync(config, 'utf8')
      try {
        writeFileSync(config, original.replace('compatibilityDate', `devtools: { enabled: false },\n  compatibilityDate`))
        await session.waitFor(/Reloading Nuxt|Restarting Nuxt/, 30_000)
        await session.wait(4000)
      }
      finally {
        writeFileSync(config, original)
      }
      await session.wait(1000)
    },
  },
  {
    id: 'nuxt-dev-install-module',
    title: 'nuxt dev (module auto-install)',
    command: '$NUXT dev --no-clear --takeover',
    cwd: 'app',
    animated: true,
    rows: 26,
    scrub: DEV_SCRUB,
    stopAfterDrive: true,
    // `useScript()` in a page makes nuxt offer to install `@nuxt/scripts`.
    // The modules DB and the registry are answered from committed fixtures and
    // `npm` is a stub that fakes the install, so the recording needs no network
    // and the fixture app is restored afterwards.
    env: {
      ...TUI_ENV,
      NODE_OPTIONS: `--import=${new URL('lib/fetch-stub.mjs', import.meta.url).href}`,
      CAPTURE_FETCH_STUBS: JSON.stringify({
        'https://api.nuxt.com/modules': fileURLToPath(new URL('fixture-data/modules.json', import.meta.url)),
        'https://registry.npmjs.org/@nuxt/scripts': fileURLToPath(new URL('fixture-data/nuxt-scripts-packument.json', import.meta.url)),
      }),
      PATH: `${fileURLToPath(new URL('fixture-data/fake-npm', import.meta.url))}:${process.env.PATH}`,
    },
    async drive({ session, cwd, bin }) {
      const config = join(cwd, 'nuxt.config.ts')
      const pkg = join(cwd, 'package.json')
      const page = join(cwd, 'app/pages/scripts.vue')
      const originals: Array<[string, string]> = [[config, readFileSync(config, 'utf8')], [pkg, readFileSync(pkg, 'utf8')]]

      // `installNuxtModule` runs the *project's* `@nuxt/cli` in-process, which
      // the fixture installed from the registry; the capture should show the
      // build under test, so the project copy is pointed at it for the
      // recording and put back afterwards. A symlink found here is residue of
      // an interrupted run, with nothing behind it to preserve.
      const projectCli = join(cwd, 'node_modules/@nuxt/cli')
      const savedCli = `${projectCli}.original`
      if (lstatSync(savedCli, { throwIfNoEntry: false })) {
        rmSync(projectCli, { recursive: true, force: true })
        renameSync(savedCli, projectCli)
      }
      const installed = lstatSync(projectCli, { throwIfNoEntry: false })
      if (installed?.isSymbolicLink()) {
        rmSync(projectCli, { force: true })
      }
      else if (installed) {
        renameSync(projectCli, savedCli)
      }
      symlinkSync(dirname(dirname(bin)), projectCli, 'dir')

      try {
        await session.waitFor(/ready in \d/, 180_000)
        await session.wait(1500)
        writeFileSync(page, '<script setup lang="ts">\nuseScript(\'https://example.com/analytics.js\')\n</script>\n\n<template>\n  <div>With analytics</div>\n</template>\n')
        await session.wait(1500)

        // The prompt fires when the page is first rendered.
        const port = session.output().match(/localhost:(\d+)/)?.[1] ?? '3000'
        await fetch(`http://localhost:${port}/scripts`).catch(() => {})
        await session.waitFor(/Do you want to install/, 60_000)
        await session.wait(1500)
        session.send('y')

        await session.waitFor(/dependencies installed/i, 60_000)
        // Long enough for the config change to reload nuxt on camera.
        await session.wait(6000)
      }
      finally {
        rmSync(page, { force: true })
        for (const [file, text] of originals) {
          writeFileSync(file, text)
        }
        rmSync(join(cwd, 'node_modules/@nuxt/scripts'), { recursive: true, force: true })
        rmSync(projectCli, { force: true })
        if (lstatSync(savedCli, { throwIfNoEntry: false })) {
          renameSync(savedCli, projectCli)
        }
      }
    },
  },
  {
    id: 'nuxt-dev-plain',
    title: 'nuxt dev (plain output)',
    command: '$NUXT dev --no-clear --takeover',
    cwd: 'app',
    animated: true,
    rows: 26,
    scrub: DEV_SCRUB,
    stopAfterDrive: true,
    env: PLAIN_ENV,
    async drive({ session }) {
      await session.waitFor(/warmed up|Vite client built/, 180_000)
      await session.wait(2500)
    },
  },
  {
    id: 'nuxt-dev-plain-static',
    title: 'nuxt dev (plain output, ready)',
    command: '$NUXT dev --no-clear --takeover',
    cwd: 'app',
    animated: false,
    rows: 26,
    scrub: DEV_SCRUB,
    stopAfterDrive: true,
    env: PLAIN_ENV,
    async drive({ session }) {
      await session.waitFor(/warmed up|Vite client built/, 180_000)
      await session.wait(2000)
    },
  },
  {
    id: 'nuxt-dev-plain-restart',
    title: 'nuxt dev (plain output, restart on config change)',
    command: '$NUXT dev --no-clear --takeover',
    cwd: 'app',
    animated: true,
    rows: 26,
    scrub: DEV_SCRUB,
    stopAfterDrive: true,
    env: PLAIN_ENV,
    async drive({ session, cwd }) {
      const { readFileSync, writeFileSync } = await import('node:fs')
      const { join } = await import('node:path')
      await session.waitFor(/warmed up|Vite client built/, 180_000)
      await session.wait(1500)
      const config = join(cwd, 'nuxt.config.ts')
      const original = readFileSync(config, 'utf8')
      try {
        writeFileSync(config, original.replace('compatibilityDate', `devtools: { enabled: false },\n  compatibilityDate`))
        await session.waitFor(/Reloading Nuxt|Restarting Nuxt/, 30_000)
        await session.wait(4000)
      }
      finally {
        writeFileSync(config, original)
      }
      await session.wait(1000)
    },
  },
  {
    id: 'nuxt-init',
    title: 'npm create nuxt',
    command: '$CREATE_NUXT my-app --packageManager npm --no-install --no-gitInit',
    cwd: 'scratch',
    animated: true,
    rows: 24,
    scrub: DEFAULT_SCRUB,
    async drive({ session }) {
      await session.waitFor(/Which template/, 60_000)
      await session.wait(1200)
      session.send('\r')
      await session.waitFor(/browse and install modules/, 60_000)
      await session.wait(800)
      session.send('\r')
      await session.waitFor(/Happy building!/, 120_000)
      await session.wait(800)
    },
  },
  {
    id: 'nuxt-curl',
    title: 'nuxt curl',
    command: '$NUXT curl /api/hello -i',
    cwd: 'app',
    animated: false,
    rows: 16,
    scrub: DEFAULT_SCRUB,
  },
  {
    id: 'nuxt-task-list',
    title: 'nuxt task list',
    command: '$NUXT task list',
    cwd: 'app',
    animated: false,
    rows: 12,
    scrub: DEFAULT_SCRUB,
  },
  {
    id: 'nuxt-module-search',
    title: 'nuxt module search',
    command: '$NUXT module search image',
    cwd: 'app',
    animated: false,
    rows: 22,
    scrub: DEFAULT_SCRUB,
    // The live API drifts (star counts, new modules), so the capture would
    // invalidate on every re-record; answer it from committed fixture data.
    env: {
      NODE_OPTIONS: `--import=${new URL('lib/fetch-stub.mjs', import.meta.url).href}`,
      CAPTURE_FETCH_STUBS: JSON.stringify({
        'https://api.nuxt.com/modules': fileURLToPath(new URL('fixture-data/modules.json', import.meta.url)),
      }),
    },
  },
]

/** Captures that need a dev server already running in the fixture. */
export const NEEDS_DEV_SERVER = new Set(['nuxt-curl', 'nuxt-task-list'])
