import { colors } from 'consola/utils'

/**
 * Thank you to Matt Eason for the proposal of this ASCII art
 * https://bsky.app/profile/matteason.me/post/3lhwnl5e4g22l
 */
const icon = [
  `     __`,
  `    /  \\  __ `,
  `   / /\\ \\/  \\     `,
  `  / /  \\  /\\ \\    `,
  ` / /___/ / _\\ \\   `,
  `/_______/ /____\\  `,
]

export const nuxtIcon = icon.map(line => colors.greenBright(line)).join('\n')
