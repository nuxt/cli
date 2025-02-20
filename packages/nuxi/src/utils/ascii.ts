/**
 * Thank you to IndyJoenz for this ASCII art
 * https://bsky.app/profile/durdraw.org/post/3liadod3gv22a
 */

export const themeColor = '\x1B[38;2;0;220;130m'
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

export const nuxtIcon = icon.map(line => line.split('').join(themeColor)).join('\n')
