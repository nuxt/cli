/**
 * The in-process contract between whatever owns the terminal and code that
 * needs it: prompts, spinners, anything that would otherwise animate frames
 * into the output stream.
 *
 * `nuxt dev` runs the framework, `@nuxt/kit` and often a second copy of
 * `@nuxt/cli` (nuxt's `installNuxtModule` imports the *project's* `@nuxt/cli`
 * and runs `module add` in-process) inside one process but from separate
 * module graphs, so the contract cannot live in a shared import: each copy
 * would see its own. It lives on `globalThis` under a well-known symbol
 * instead, published by whoever is drawing the terminal and looked up by
 * whoever wants it.
 *
 * A consumer that finds no host owns the terminal itself and carries on as it
 * always has, so a host is never required, only an offer.
 */

const HOST_KEY = Symbol.for('nuxt:terminal-host')

/** A piece of long-running work reported on the host's own status surface. */
export interface TerminalTask {
  /** Replace the label shown for the work. */
  update: (label: string) => void
  /**
   * Finish. `message` is the line the work leaves behind, shown however the
   * host records outcomes; without one the task simply disappears.
   */
  stop: (message?: string, outcome?: 'success' | 'failure') => void
}

/** A message that must reach the user, held until it is let go. */
export interface TerminalNotification {
  title?: string
  message: string
  level?: 'info' | 'warn'
}

export interface TerminalNotice {
  /** Retract the notice: attention is no longer needed. */
  dismiss: () => void
  /** Settles once the notice is gone: acknowledged by the user or retracted. */
  dismissed: Promise<void>
}

export interface TerminalHost {
  /**
   * The revision of this contract. Bumped only when an existing member
   * changes shape; new optional members do not.
   */
  version: 1
  /**
   * Run `work` with the terminal to itself until the promise settles: the
   * host's UI is suspended and stdin released, so `work` can draw frames and
   * read keys. Questions are asked in here. Calls are serialised by the host,
   * since two of them drawing at once can be neither read nor answered, but
   * re-entrant: a call made from inside a borrow already has the terminal and
   * runs directly, so layered consumers cannot deadlock against themselves.
   */
  withTerminal: <T>(work: () => Promise<T>) => Promise<T>
  /**
   * Report long-running work on the host's status surface, instead of
   * animating a spinner into the output stream where the host would have to
   * capture or repaint around every frame.
   */
  startTask: (label: string) => TerminalTask
  /**
   * Show something that must not scroll away unnoticed: an auth code, a
   * permission request, anything useless unheeded. Held on the host's status
   * surface until the user acknowledges it or the caller retracts it. A
   * caller that learns attention is no longer needed (the code was entered,
   * the permission granted) should dismiss the notice itself rather than
   * leave it standing.
   *
   * Optional so hosts can adopt it separately; feature-test before calling.
   */
  notify?: (notification: TerminalNotification) => TerminalNotice
}

type HostCarrier = typeof globalThis & { [HOST_KEY]?: TerminalHost }

/** Publish `host` for everything in the process, until the returned call. */
export function registerTerminalHost(host: TerminalHost): () => void {
  const carrier = globalThis as HostCarrier
  carrier[HOST_KEY] = host
  return () => {
    if (carrier[HOST_KEY] === host) {
      delete carrier[HOST_KEY]
    }
  }
}

/** The terminal host published in this process, if a compatible one is. */
export function useTerminalHost(): TerminalHost | undefined {
  const host = (globalThis as HostCarrier)[HOST_KEY]
  return host?.version === 1 ? host : undefined
}
