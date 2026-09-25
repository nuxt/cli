import type { ProgressSnapshot } from '../utils/progress-snapshot'

import { inlineScript, progressClient, recoveryClient } from './loading-client'
import { PROGRESS_PATH } from './progress'

const CAPTION_ID = 'nuxt-dev-phase'
const PROGRESS_PROPERTY = '--nuxt-progress'
const POLL_INTERVAL_MS = 200
const MAX_POLL_INTERVAL_MS = 1000

/**
 * Turns the static bar Nuxt's own loading page draws into a determinate one, and
 * styles the caption the client appends. A template with no loading bar of its
 * own still renders; it just has nothing to make determinate.
 */
const STYLES = `.nuxt-loader-bar{right:auto!important;width:var(${PROGRESS_PROPERTY},4%);transition:width .3s ease}
#${CAPTION_ID}{position:fixed;left:0;right:0;bottom:14px;text-align:center;font:12px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif;opacity:.55;font-variant-numeric:tabular-nums}`

function progressTags(snapshot: ProgressSnapshot): string {
  return `<style>${STYLES}</style>${inlineScript(progressClient, {
    progressPath: PROGRESS_PATH,
    captionId: CAPTION_ID,
    progressProperty: PROGRESS_PROPERTY,
    elapsed: snapshot.elapsed,
    pollInterval: POLL_INTERVAL_MS,
    maxPollInterval: MAX_POLL_INTERVAL_MS,
  })}`
}

/**
 * Add live progress to the loading page Nuxt itself would render.
 *
 * The page keeps its own markup, styling and version, and keeps polling as its
 * own script already does, so a failed `EventSource` still recovers. What this
 * adds is a determinate bar, a phase caption, the build error inline, and a
 * reload driven by the server rather than by a poll interval.
 */
export function withProgress(html: string, snapshot: ProgressSnapshot): string {
  const tags = progressTags(snapshot)
  const index = html.lastIndexOf('</body>')
  return index === -1 ? html + tags : html.slice(0, index) + tags + html.slice(index)
}

/**
 * Injected into the error page so a full-page build error recovers on its own
 * once the next load succeeds.
 */
export const RECOVERY_SCRIPT: string = inlineScript(recoveryClient, { progressPath: PROGRESS_PATH })
