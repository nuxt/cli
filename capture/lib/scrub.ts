import type { Style } from 'ansivision'
import { homedir } from 'node:os'

interface ScrubStep {
  pattern: RegExp
  replacement: (match: RegExpMatchArray) => string
}

interface ScrubRule {
  id: string
  description: string
  steps: ScrubStep[]
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Text substitutions applied to each rendered frame before it is turned into
 * SVG. They run on emulated terminal lines rather than the raw byte stream, so
 * a token split across pty chunks cannot dodge a rule.
 *
 * Each rule is opt-in per capture so that a performance write-up can keep the
 * real numbers while docs captures stay diff-stable. The rules that ran are
 * recorded in the SVG itself.
 */
const RULES: Record<string, ScrubRule> = {
  ports: {
    id: 'ports',
    description: 'dev server ports pinned to 3000',
    steps: [
      { pattern: /(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):\d{2,5}/g, replacement: match => `${match[1]}:3000` },
    ],
  },
  hostnames: {
    id: 'hostnames',
    description: 'LAN addresses replaced with a fixed private address',
    steps: [
      { pattern: /\b(?!127\.)(?!0\.0\.0\.0)(?:\d{1,3}\.){3}\d{1,3}(:\d{2,5})?\b/g, replacement: match => match[1] ? '192.168.1.10:3000' : '192.168.1.10' },
    ],
  },
  timings: {
    id: 'timings',
    description: 'reported durations pinned so re-recordings do not churn',
    steps: [
      // One replacement for both units: a duration that crosses the 1s
      // boundary between two recordings must not change the scrubbed text.
      { pattern: /\b\d+(?:\.\d+)?\s?ms\b/g, replacement: () => '42 ms' },
      { pattern: /\b\d+(?:\.\d+)?\s?s(?![a-z])/g, replacement: () => '42 ms' },
    ],
  },
  versions: {
    id: 'versions',
    description: 'semver versions replaced with x.y.z',
    steps: [
      // The lookarounds keep dotted quads (IP addresses) out of reach.
      { pattern: /(?<![.\d])v?\d+\.\d+\.\d+(?:-[\w.]+)?(?![.\d])/g, replacement: () => 'x.y.z' },
    ],
  },
  paths: {
    id: 'paths',
    description: 'home directory and temporary paths collapsed',
    steps: [
      { pattern: new RegExp(escapeRegExp(homedir()), 'g'), replacement: () => '~' },
      { pattern: /\/tmp\/[\w.-]*capture[\w.-]*/g, replacement: () => '~/project' },
    ],
  },
  dates: {
    id: 'dates',
    description: 'ISO dates and clock times pinned',
    steps: [
      { pattern: /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} GMT\b/g, replacement: () => 'Thu, 01 Jan 2026 12:00:00 GMT' },
      { pattern: /\b\d{4}-\d{2}-\d{2}\b/g, replacement: () => '2026-01-01' },
      { pattern: /\b\d{2}:\d{2}:\d{2}\b/g, replacement: () => '12:00:00' },
    ],
  },
  spinner: {
    id: 'spinner',
    description: 'spinner glyphs pinned to one phase',
    steps: [
      { pattern: /[⠙⠹⠸⠼⠴⠦⠧⠇⠏]/g, replacement: () => '⠋' },
      { pattern: /[◒◓◑]/g, replacement: () => '◐' },
      // A prompt spinner also animates a trailing run of up to three dots, so
      // how many of them a recording caught is a function of how long the work
      // took. The message itself is what identifies the line.
      { pattern: /^(\s*◐\s.*?)\.{1,3}(\s*)$/g, replacement: match => match[1]! + match[2]! },
    ],
  },
  qr: {
    id: 'qr',
    // The QR block encodes the real network URL before any text scrubbing can
    // touch it, so it is re-rendered rather than substituted (see frames.ts).
    description: 'QR code re-rendered for the scrubbed network URL',
    steps: [],
  },
}

export function resolveRules(ruleIds: string[]): ScrubRule[] {
  return ruleIds.map((id) => {
    const rule = RULES[id]
    if (!rule) {
      throw new Error(`unknown scrub rule "${id}", expected one of ${Object.keys(RULES).join(', ')}`)
    }
    return rule
  })
}

/**
 * Apply the given rules to one rendered line, keeping the per-character style
 * array aligned: replacement text inherits the style of the first replaced
 * character.
 */
export function scrubLine(line: string, styles: Style[], rules: ScrubRule[]): { line: string, styles: Style[] } {
  let currentLine = line
  let currentStyles: (Style | undefined)[] = Array.from({ length: line.length }, (_, index) => styles[index])
  for (const rule of rules) {
    for (const step of rule.steps) {
      const next = applyStep(currentLine, currentStyles, step)
      currentLine = next.line
      currentStyles = next.styles
    }
  }
  return { line: currentLine, styles: currentStyles as Style[] }
}

function applyStep(line: string, styles: (Style | undefined)[], step: ScrubStep): { line: string, styles: (Style | undefined)[] } {
  let out = ''
  const outStyles: (Style | undefined)[] = []
  let last = 0
  for (const match of line.matchAll(step.pattern)) {
    const start = match.index!
    out += line.slice(last, start)
    outStyles.push(...styles.slice(last, start))
    const replacement = step.replacement(match)
    out += replacement
    for (let index = 0; index < replacement.length; index++) {
      outStyles.push(styles[start])
    }
    last = start + match[0].length
  }
  out += line.slice(last)
  outStyles.push(...styles.slice(last))
  return { line: out, styles: outStyles }
}

export function describeRules(ruleIds: string[]): string {
  if (ruleIds.length === 0) {
    return 'none (raw output)'
  }
  return ruleIds.map(id => `${id} (${RULES[id]!.description})`).join('; ')
}
