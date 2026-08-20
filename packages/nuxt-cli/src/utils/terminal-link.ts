import process from 'node:process'

import { supportsHyperlinks } from 'clickable-path'

/**
 * Render `label` as a clickable link to `url`.
 *
 * `clickable-path` covers file paths, whose targets it builds itself; this is
 * the same OSC 8 escape for a target that is already a URL. Terminal support
 * is decided by `clickable-path` so both kinds of link appear together or not
 * at all.
 */
export function terminalLink(label: string, url: string, options: { stream?: { isTTY?: boolean } } = {}): string {
  if (!supportsHyperlinks(options.stream ?? process.stdout)) {
    return label
  }
  return `\u001B]8;;${url}\u0007${label}\u001B]8;;\u0007`
}
