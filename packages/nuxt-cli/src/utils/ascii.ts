/**
 * Thank you to IndyJoenz for this ASCII art
 * https://bsky.app/profile/durdraw.org/post/3liadod3gv22a
 */

import { paint } from './terminal-theme'

const icon = [
  `        .d$b.`,
  `       i$$A$$L  .d$b`,
  `     .$$F\` \`$$L.$$A$$.`,
  `    j$$'    \`4$$:\` \`$$.`,
  `   j$$'     .4$:    \`$$.`,
  `  j$$\`     .$$:      \`4$L`,
  ` :$$:____.d$$:  _____.:$$:`,
  ` \`4$$$$$$$$P\` .i$$$$$$$$P\``,
]

/** The mark in Nuxt green, ending with the terminal's colour handed back. */
export function nuxtIcon(): string {
  return icon.map(line => paint('brand', line)).join('\n')
}
