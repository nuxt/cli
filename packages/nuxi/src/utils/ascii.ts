import { colors } from 'consola/utils'

export function nuxtAscii() {
  /**
   * Thank you to Matt Eason for the proposal of this ASCII art
   * https://bsky.app/profile/matteason.me/post/3lhwnl5e4g22l
   */
  const icon = `     __
    /  \\  __ 
   / /\\ \\/  \\     
  / /  \\  /\\ \\    
 / /___/ / _\\ \\   
/_______/ /____\\  
`

  const wordmark = `

++   ++  ++  ++  ++  ++  ++++++
++++ ++  ++  ++   ++++     ++
++ ++++  ++  ++   ++++     ++
++  +++   ++++   ++  ++    ++
`
  const iconLines = icon.split('\n')
  const wordmarkLines = wordmark.split('\n')

  return iconLines.map((iconLine, index) => {
    return `${colors.greenBright(iconLine)}${wordmarkLines[index]}`
  }).join('\n')
}
