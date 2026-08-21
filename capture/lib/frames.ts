import type { Style } from 'ansivision'
import type { Chunk } from './pty.ts'
import type { Frame } from './svg.ts'
import { createHash } from 'node:crypto'
import { RenderStream } from 'ansivision'
import { renderUnicodeCompact } from 'uqr'
import { resolveRules, scrubLine } from './scrub.ts'

export interface FrameOptions {
  rows: number
  scrubRules: string[]
  /** Frames closer together than this are merged. */
  minFrameMs?: number
  /** Upper bound on frame count, enforced by raising the merge window. */
  maxFrames?: number
}

/** The URL the scrubbed Network line shows, so the QR can match it. */
const SCRUBBED_NETWORK_URL = 'http://192.168.1.10:3000/'

const QR_LINE_RE = /^[█▀▄ ]{10,}$/
const MIN_QR_LINES = 3

let qrArt: string[] | undefined
function scrubbedQrArt(): string[] {
  // `uqr` is what the CLI itself renders the QR with.
  qrArt ??= renderUnicodeCompact(SCRUBBED_NETWORK_URL).split('\n')
  return qrArt
}

function snapshot(stream: RenderStream, at: number, rows: number): Frame {
  const renderer = stream.renderer
  const frameObject = renderer.frameObjects.at(-1)
  const contents = frameObject?.contents ?? ''
  const lines = contents.split('\n')
  const visible = lines.length > rows ? lines.slice(lines.length - rows) : lines
  const styles = (frameObject?.styles ?? []).slice(lines.length > rows ? lines.length - rows : 0)
  return { at, lines: visible, styles }
}

export function buildFrames(chunks: Chunk[], options: FrameOptions): Frame[] {
  const rules = resolveRules(options.scrubRules)
  const redrawQr = options.scrubRules.includes('qr')

  const stream = new RenderStream()
  const raw: Frame[] = []
  for (const chunk of chunks) {
    stream.write(chunk.data)
    const frame = snapshot(stream, chunk.at, options.rows)
    raw.push(scrubFrame(frame, rules, redrawQr))
  }
  if (raw.length === 0) {
    return [{ at: 0, lines: [], styles: [] }]
  }

  let minFrameMs = options.minFrameMs ?? 80
  const maxFrames = options.maxFrames ?? 90
  // `coalesce` can never return fewer than one frame, so anything below that
  // would spin the merge loop forever.
  if (!Number.isInteger(maxFrames) || maxFrames < 1) {
    throw new Error(`maxFrames must be a positive integer, got ${maxFrames}`)
  }
  let frames = coalesce(raw, minFrameMs)
  while (frames.length > maxFrames) {
    minFrameMs *= 1.5
    frames = coalesce(raw, minFrameMs)
  }
  return frames
}

/**
 * The capture's identity: every distinct line the session ever displayed,
 * scrubbed, sorted and deduplicated. Sorting makes it immune to log-ordering
 * races, and working from the full transcript rather than sampled frames
 * makes it immune to machine speed. This is what decides whether a committed
 * SVG is stale; the SVG itself keeps the real timings.
 */
export function buildFingerprint(chunks: Chunk[], options: FrameOptions): string {
  const rules = resolveRules(options.scrubRules)
  const stream = new RenderStream()
  const seen = new Set<string>()
  const styleSeen = new Set<string>()
  // The whole buffer, not the visible window: whether a line scrolls past
  // between two chunk boundaries depends on machine speed.
  const collect = (): void => {
    const frameObject = stream.renderer.frameObjects.at(-1)
    const lines = (frameObject?.contents ?? '').split('\n')
    const styles = frameObject?.styles ?? []
    for (let row = 0; row < lines.length; row++) {
      const scrubbed = scrubLine(lines[row]!, styles[row] ?? [], rules)
      const [line, lineStyles] = trimStyledLine(scrubbed.line, scrubbed.styles)
      // QR modules encode the machine's real address and never carry content.
      if (line !== '' && !(QR_LINE_RE.test(line) && /[█▀▄]/.test(line))) {
        seen.add(line)
        styleSeen.add(`${line}\u001F${styleRuns(line, lineStyles)}`)
      }
    }
  }
  for (const chunk of chunks) {
    stream.write(chunk.data)
    collect()
  }
  // The digest covers colors and text attributes, which the readable line
  // list above cannot: a style-only CLI change must still invalidate.
  const digest = createHash('sha256').update([...styleSeen].sort().join('\n')).digest('hex').slice(0, 16)
  return `styles: ${digest}\n${[...seen].sort().join('\n')}\n`
}

function scrubFrame(frame: Frame, rules: ReturnType<typeof resolveRules>, redrawQr: boolean): Frame {
  const lines: string[] = []
  const styles: Style[][] = []
  for (let row = 0; row < frame.lines.length; row++) {
    const scrubbed = scrubLine(frame.lines[row]!, frame.styles[row] ?? [], rules)
    const [line, lineStyles] = trimStyledLine(scrubbed.line, scrubbed.styles)
    lines.push(line)
    styles.push(lineStyles)
  }
  const result = { at: frame.at, lines, styles }
  return redrawQr ? replaceQrBlock(result) : result
}

/**
 * Swap the recorded QR block (which encodes the machine's real address) for
 * one rendered from the scrubbed URL, keeping the original indentation.
 */
function replaceQrBlock(frame: Frame): Frame {
  let start = -1
  let end = -1
  for (let row = 0; row < frame.lines.length; row++) {
    const line = frame.lines[row]!
    const isQrLine = QR_LINE_RE.test(line) && /[█▀▄]/.test(line)
    if (isQrLine && start === -1) {
      start = row
    }
    if (isQrLine) {
      end = row
    }
    else if (start !== -1) {
      break
    }
  }
  const blockLength = end - start + 1
  if (start === -1 || blockLength < MIN_QR_LINES) {
    return frame
  }

  const indent = frame.lines[start]!.match(/^\s*/)![0]
  // A block shorter than the full art has scrolled partly out of the viewport:
  // off the top when it starts at row 0, off the bottom otherwise. Substitute
  // the matching slice so the frame keeps its shape.
  const full = scrubbedQrArt()
  const slice = blockLength >= full.length
    ? full
    : start === 0
      ? full.slice(full.length - blockLength)
      : full.slice(0, blockLength)
  const art = slice.map(line => indent + line)
  const lines = [...frame.lines.slice(0, start), ...art, ...frame.lines.slice(end + 1)]
  const styles = [...frame.styles.slice(0, start), ...art.map(() => [] as Style[]), ...frame.styles.slice(end + 1)]
  return { at: frame.at, lines, styles }
}

/**
 * Trailing padding length depends on the pre-scrub text, so it churns even
 * though it is invisible. Backgrounds are kept: there a trailing space is a
 * visible colored cell, and it must stay visible to the identity checks too.
 */
function trimStyledLine(line: string, styles: Style[]): [string, Style[]] {
  let length = line.length
  while (length > 0 && line[length - 1] === ' ' && !styles[length - 1]?.background) {
    length--
  }
  return [line.slice(0, length), styles.slice(0, length)]
}

/** Run-length encode a line's styles, so style-only differences are visible to identity checks. */
function styleRuns(line: string, styles: (Style | undefined)[]): string {
  const runs: string[] = []
  let current = ''
  let count = 0
  for (let col = 0; col < line.length; col++) {
    const style = styles[col]
    const key = style ? JSON.stringify([style.foreground, style.background, style.bold, style.dim, style.italic, style.underline, style.inverse, style.strikethrough]) : ''
    if (key === current) {
      count++
      continue
    }
    if (count > 0) {
      runs.push(`${count}:${current}`)
    }
    current = key
    count = 1
  }
  if (count > 0) {
    runs.push(`${count}:${current}`)
  }
  return runs.join(';')
}

const frameSignatures = new WeakMap<Frame, string>()
function frameSignature(frame: Frame): string {
  let signature = frameSignatures.get(frame)
  if (signature === undefined) {
    signature = frame.lines.map((line, row) => `${line}\u001F${styleRuns(line, frame.styles[row] ?? [])}`).join('\n')
    frameSignatures.set(frame, signature)
  }
  return signature
}

function coalesce(raw: Frame[], minFrameMs: number): Frame[] {
  const frames: Frame[] = []
  for (const frame of raw) {
    const previous = frames.at(-1)
    if (!previous) {
      frames.push({ ...frame, at: 0 })
      continue
    }
    const sameContent = frameSignature(previous) === frameSignature(frame)
    if (sameContent || frame.at - previous.at < minFrameMs) {
      frames[frames.length - 1] = { at: previous.at, lines: frame.lines, styles: frame.styles }
      continue
    }
    frames.push(frame)
  }
  return frames
}
