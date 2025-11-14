import process from 'node:process'
import { stripVTControlCharacters } from 'node:util'
import { colors } from 'consola/utils'

function getStringWidth(str: string): number {
  const stripped = stripVTControlCharacters(str)
  let width = 0

  for (const char of stripped) {
    const code = char.codePointAt(0)
    if (!code) {
      continue
    }

    // Variation selectors don't add width
    if (code >= 0xFE00 && code <= 0xFE0F) {
      continue
    }

    // Emoji and wide characters (simplified heuristic)
    // Most emojis are in these ranges
    if (
      (code >= 0x1F300 && code <= 0x1F9FF) // Emoticons, symbols, pictographs
      || (code >= 0x1F600 && code <= 0x1F64F) // Emoticons
      || (code >= 0x1F680 && code <= 0x1F6FF) // Transport and map symbols
      || (code >= 0x2600 && code <= 0x26FF) // Miscellaneous symbols (includes ❤)
      || (code >= 0x2700 && code <= 0x27BF) // Dingbats
      || (code >= 0x1F900 && code <= 0x1F9FF) // Supplemental symbols and pictographs
      || (code >= 0x1FA70 && code <= 0x1FAFF) // Symbols and Pictographs Extended-A
    ) {
      width += 2
    }
    else {
      width += 1
    }
  }

  return width
}

export function formatInfoBox(infoObj: Record<string, string | undefined>): string {
  let firstColumnLength = 0
  let ansiFirstColumnLength = 0
  const entries = Object.entries(infoObj).map(([label, val]) => {
    if (label.length > firstColumnLength) {
      ansiFirstColumnLength = colors.bold(colors.whiteBright(label)).length + 6
      firstColumnLength = label.length + 6
    }
    return [label, val || '-'] as const
  })

  // get maximum width of terminal
  const terminalWidth = Math.max(process.stdout.columns || 80, firstColumnLength) - 8 /* box padding + extra margin */

  let boxStr = ''
  for (const [label, value] of entries) {
    const formattedValue = value
      .replace(/\b@([^, ]+)/g, (_, r) => colors.gray(` ${r}`))
      .replace(/`([^`]*)`/g, (_, r) => r)

    boxStr += (`${colors.bold(colors.whiteBright(label))}`).padEnd(ansiFirstColumnLength)

    let boxRowLength = firstColumnLength

    // Split by spaces and wrap as needed
    const words = formattedValue.split(' ')
    let currentLine = ''

    for (const word of words) {
      const wordLength = getStringWidth(word)
      const spaceLength = currentLine ? 1 : 0

      if (boxRowLength + wordLength + spaceLength > terminalWidth) {
        // Wrap to next line
        if (currentLine) {
          boxStr += colors.cyan(currentLine)
        }
        boxStr += `\n${' '.repeat(firstColumnLength)}`
        currentLine = word
        boxRowLength = firstColumnLength + wordLength
      }
      else {
        currentLine += (currentLine ? ' ' : '') + word
        boxRowLength += wordLength + spaceLength
      }
    }

    if (currentLine) {
      boxStr += colors.cyan(currentLine)
    }

    boxStr += '\n'
  }

  return boxStr
}
