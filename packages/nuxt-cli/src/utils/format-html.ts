/** Phrasing content, kept on the line of its surrounding text. */
const INLINE = new Set(['a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'dfn', 'em', 'i', 'img', 'kbd', 'mark', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr'])
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
/** Elements whose content is text rather than markup, and so is never reindented. */
const RAW = new Set(['pre', 'textarea', 'script', 'style'])

const NODE_RE = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[!/]?[a-z](?:[^>"']|"[^"]*"|'[^']*')*>/gi
const TAG_NAME_RE = /^<\/?\s*([a-z][\w:-]*)/i

/**
 * Reindent an HTML document so a minified response is readable.
 *
 * Only whitespace between block-level boundaries is rewritten. Inline elements
 * keep their surrounding text, and `pre`, `textarea`, `script` and `style`
 * bodies are copied verbatim, so what a browser renders does not change.
 */
export function formatHtml(html: string, indent = '  '): string {
  const lines: string[] = []
  const stack: { name: string, line: number }[] = []
  let line = ''
  let position = 0

  const pad = (): string => indent.repeat(stack.length)
  const push = (text: string): void => {
    lines.push(pad() + text.replace(/\n[^\S\n]*/g, `\n${pad()}`))
  }
  const flush = (): void => {
    if (line.trim()) {
      push(line.trim())
    }
    line = ''
  }

  NODE_RE.lastIndex = 0
  let match: RegExpExecArray | null
  // eslint-disable-next-line no-cond-assign
  while ((match = NODE_RE.exec(html))) {
    line += html.slice(position, match.index)
    position = NODE_RE.lastIndex

    const node = match[0]
    const name = TAG_NAME_RE.exec(node)?.[1]?.toLowerCase()
    if (!name || INLINE.has(name)) {
      line += node
      continue
    }

    const closing = node[1] === '/'
    const selfClosing = node.endsWith('/>') || VOID.has(name)

    if (RAW.has(name) && !closing && !selfClosing) {
      const rest = html.slice(position)
      const end = new RegExp(`</${name}\\s*>`, 'i').exec(rest)
      const body = end ? rest.slice(0, end.index + end[0].length) : rest
      flush()
      lines.push(pad() + node + body)
      position += body.length
      NODE_RE.lastIndex = position
      continue
    }

    if (closing) {
      const index = stack.findLastIndex(entry => entry.name === name)
      // A stray closing tag is printed where it stands, without dedenting.
      if (index === -1) {
        flush()
        push(node)
        continue
      }
      const open = stack[index]!
      // A block with only inline children stays on the line it opened on.
      if (index === stack.length - 1 && open.line === lines.length && line.trim() && !line.includes('\n')) {
        lines[open.line - 1] += `${line.trim()}${node}`
        line = ''
        stack.length = index
        continue
      }
      flush()
      stack.length = index
      push(node)
      continue
    }

    flush()
    push(node)
    if (!selfClosing) {
      stack.push({ name, line: lines.length })
    }
  }

  line += html.slice(position)
  flush()

  return lines.join('\n')
}
