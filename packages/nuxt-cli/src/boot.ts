import process from 'node:process'

/** Flags that mean this is not going to be a panel session. */
const OPT_OUT = /^(?:--help|-h|--version|-v|--no-tui|--tui|--inspect|--inspect-brk|--profile)(?:=|$)/

/**
 * Paint the dev panel and bind its shortcuts, before the command graph loads.
 *
 * The `dev` command joins the same session and the same shortcut context, and
 * gives the terminal back if the resolved arguments refuse the panel.
 */
export async function bootDevUI(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv[0] !== 'dev' || argv.some(arg => OPT_OUT.test(arg))) {
    return
  }
  // Cheap first pass at what `resolveDevUISupport` decides properly.
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    return
  }
  const options = { cwd: resolveCwd(argv), startTime: globalThis.__nuxt_cli__?.startTime }
  const { paintFirstFrame } = await import('./dev/tui/first-frame')
  const start = paintFirstFrame(options)
  if (!start) {
    return
  }
  try {
    const { devShortcutContext } = await import('./dev/shortcut-context')
    const { setupDevUI } = await import('./dev/tui/controller')
    await setupDevUI(devShortcutContext().context, { ...options, start })
  }
  catch (error) {
    // The frame is on screen with nothing behind it, so give the terminal back
    // before the failure travels on.
    start.surface.close()
    throw error
  }

  // Loading the command graph blocks the loop, so the key reader goes first.
  await new Promise(resolve => setImmediate(resolve))
}

/** Where to read the project version from: `--cwd`, or `dev`'s `ROOTDIR`. */
function resolveCwd(argv: string[]): string | undefined {
  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index]!
    if (arg.startsWith('--cwd=')) {
      return arg.slice('--cwd='.length)
    }
    if (arg === '--cwd') {
      return argv[index + 1]
    }
  }
  return argv[1] && !argv[1].startsWith('-') ? argv[1] : undefined
}
