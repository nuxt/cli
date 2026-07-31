import process from 'node:process'
import { stripVTControlCharacters, styleText } from 'node:util'

const AT_MENTION_RE = /\b@([^, ]+)/g
const BACKTICK_RE = /`([^`]*)`/g

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
      ansiFirstColumnLength = styleText(['bold', 'whiteBright'], label).length + 6
      firstColumnLength = label.length + 6
    }
    return [label, val || '-'] as const
  })

  // get maximum width of terminal
  const terminalWidth = Math.max(process.stdout.columns || 80, firstColumnLength) - 8 /* box padding + extra margin */

  let boxStr = ''
  for (const [label, value] of entries) {
    const formattedValue = value
      .replace(AT_MENTION_RE, (_, r) => styleText('gray', ` ${r}`))
      .replace(BACKTICK_RE, (_, r) => r)

    boxStr += styleText(['bold', 'whiteBright'], label).padEnd(ansiFirstColumnLength)

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
          boxStr += styleText('cyan', currentLine)
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
      boxStr += styleText('cyan', currentLine)
    }

    boxStr += '\n'
  }

  return boxStr
}

/**
 * Format an elapsed duration in milliseconds for display, using `ms` below a
 * second and seconds (or minutes and seconds) above it.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`
  }

  const totalSeconds = ms / 1000
  if (totalSeconds < 60) {
    return `${Number(totalSeconds.toFixed(totalSeconds < 10 ? 2 : 1))}s`
  }

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.round(totalSeconds - minutes * 60)
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`
}
