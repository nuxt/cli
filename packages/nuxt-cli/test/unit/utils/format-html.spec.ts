import { describe, expect, it } from 'vitest'

import { formatHtml } from '../../../src/utils/format-html'

/** Whitespace between tags is the only thing `formatHtml` is allowed to rewrite. */
function normalise(html: string): string {
  return html.replace(/>\s+</g, '><').trim()
}

describe('formatHtml', () => {
  it('indents a minified document', () => {
    const html = '<!DOCTYPE html><html><head><title>t</title></head><body><div id="app"><ul><li>1</li><li>2</li></ul></div></body></html>'

    expect(formatHtml(html)).toMatchInlineSnapshot(`
      "<!DOCTYPE html>
      <html>
        <head>
          <title>t</title>
        </head>
        <body>
          <div id="app">
            <ul>
              <li>1</li>
              <li>2</li>
            </ul>
          </div>
        </body>
      </html>"
    `)
    expect(normalise(formatHtml(html))).toBe(normalise(html))
  })

  it('keeps inline elements on the line of their text', () => {
    expect(formatHtml('<p>a<b>b</b>c<a href="/x">link</a></p>')).toBe('<p>a<b>b</b>c<a href="/x">link</a></p>')
  })

  it('copies raw element bodies verbatim', () => {
    const html = '<div><pre>  keep\n   me  </pre><textarea> x </textarea><script>const a = `1\n2`</script><style>a{color:red}</style></div>'

    expect(formatHtml(html)).toMatchInlineSnapshot(`
      "<div>
        <pre>  keep
         me  </pre>
        <textarea> x </textarea>
        <script>const a = \`1
      2\`</script>
        <style>a{color:red}</style>
      </div>"
    `)
  })

  it('does not confuse a `>` inside an attribute for the end of a tag', () => {
    expect(formatHtml('<div data-x="a>b" data-y=\'{"a":1}\'>t</div>')).toBe('<div data-x="a>b" data-y=\'{"a":1}\'>t</div>')
    expect(formatHtml('<div data-x="a>b"><p>x</p></div>')).toBe('<div data-x="a>b">\n  <p>x</p>\n</div>')
    expect(formatHtml('<div title="a<b"><p>x</p></div>')).toBe('<div title="a<b">\n  <p>x</p>\n</div>')
  })

  it('leaves comments, self-closing tags and bare text alone', () => {
    expect(formatHtml('<!-- c --><svg><path d="M0 0"/></svg>')).toBe('<!-- c -->\n<svg>\n  <path d="M0 0"/>\n</svg>')
    expect(formatHtml('plain text')).toBe('plain text')
  })

  it('does not lose content when tags are unbalanced', () => {
    expect(formatHtml('<div>unclosed<p>x</div>')).toContain('unclosed')
    expect(formatHtml('</div>')).toBe('</div>')
    expect(formatHtml('<div><p>x</p></span><p>y</p></div>')).toBe('<div>\n  <p>x</p>\n  </span>\n  <p>y</p>\n</div>')
  })
})
