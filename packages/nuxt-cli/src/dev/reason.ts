import { relativeTo } from '../utils/paths'

/** Structured cause of a dev server reload or restart. */
export type DevRestartReason
  = | { type: 'config', files: string[], keys?: string[] }
    | { type: 'dist-removed' }
    | { type: 'hook' }
    | { type: 'shortcut' }
    | { type: 'error', message: string }

export interface FormatRestartReasonOptions {
  rootDir: string
  /** A new process is taking over, rather than reloading in place. */
  hard?: boolean
  /** Render file names as terminal hyperlinks. Disable for non-terminal output. */
  link?: boolean
}

/**
 * Combine a queued reason with a newer one, so a debounced reload can report
 * every file that changed within the window.
 */
export function mergeRestartReasons(previous: DevRestartReason | undefined, next: DevRestartReason): DevRestartReason {
  if (previous?.type !== 'config' || next.type !== 'config') {
    return next
  }
  return {
    type: 'config',
    files: [...new Set([...previous.files, ...next.files])],
    keys: previous.keys || next.keys
      ? [...new Set([...previous.keys || [], ...next.keys || []])]
      : undefined,
  }
}

/**
 * Record which `nuxt.config` keys changed on a config-triggered reload. Keys are
 * sorted so the printed line does not reorder when config keys are moved around.
 */
export function withConfigKeys(reason: DevRestartReason | undefined, keys: string[] | undefined): DevRestartReason | undefined {
  if (reason?.type !== 'config' || !keys?.length) {
    return reason
  }
  return { ...reason, keys: [...keys].sort() }
}

/** Describe what caused a reload or restart, without saying what happens next. */
export function formatRestartCause(reason: DevRestartReason, options: FormatRestartReasonOptions): string {
  switch (reason.type) {
    case 'config':
      return `${formatFileList(reason.files, options)} changed`
    case 'dist-removed':
      return 'Build output was removed'
    case 'hook':
      return 'Nuxt requested a restart'
    case 'shortcut':
      return 'Restart requested'
    case 'error':
      return `Unhandled error: ${reason.message}`
  }
}

/** One line saying a config file was written without changing the resolved config. */
export function formatSkippedReload(reason: Extract<DevRestartReason, { type: 'config' }>, options: FormatRestartReasonOptions): string {
  return `${formatFileList(reason.files, options)} saved without changing config.`
}

/** Follow-up line naming the config keys a reload picked up. */
export function formatChangedKeys(keys: string[]): string | undefined {
  if (!keys.length) {
    return undefined
  }
  return `${formatTruncatedList(keys.map(key => `\`${key}\``), 'key')} updated`
}

/** One line saying what caused a reload or restart and what is happening as a result. */
export function formatRestartReason(reason: DevRestartReason | undefined, options: FormatRestartReasonOptions): string {
  const action = options.hard ? 'Restarting Nuxt in a new process' : 'Reloading Nuxt'
  if (!reason) {
    return `${action}...`
  }
  return `${formatRestartCause(reason, options)}. ${action}...`
}

const MAX_LISTED_ITEMS = 2

function formatFileList(files: string[], options: FormatRestartReasonOptions): string {
  const names = files.map(file => options.link === false ? relativeTo(options.rootDir, file, { link: false }) : relativeTo(options.rootDir, file))
  if (names.length === 0) {
    return 'A file'
  }
  return formatTruncatedList(names, 'file')
}

function formatTruncatedList(items: string[], noun: string): string {
  if (items.length <= MAX_LISTED_ITEMS) {
    return items.join(' and ')
  }
  const remaining = items.length - MAX_LISTED_ITEMS
  return `${items.slice(0, MAX_LISTED_ITEMS).join(', ')} and ${remaining} other ${noun}${remaining === 1 ? '' : 's'}`
}
