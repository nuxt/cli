export interface Summary {
  n: number
  median: number
  min: number
  max: number
  p95: number
}

export function summarise(samples: number[]): Summary {
  if (samples.length === 0) {
    throw new Error('cannot summarise an empty sample set')
  }
  const sorted = [...samples].sort((a, b) => a - b)
  return {
    n: sorted.length,
    median: quantile(sorted, 0.5),
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    p95: quantile(sorted, 0.95),
  }
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q
  const lower = Math.floor(pos)
  const upper = Math.ceil(pos)
  if (lower === upper) {
    return sorted[lower]!
  }
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (pos - lower)
}

export function formatMs(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${value.toFixed(0)} ms`
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 2) {
    return `${(bytes / 1024 ** 2).toFixed(2)} MB`
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} kB`
  }
  return `${bytes} B`
}

export function formatDelta(baseline: number, head: number): string {
  if (baseline === 0) {
    return 'n/a'
  }
  const pct = ((head - baseline) / baseline) * 100
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)}%`
}

export function markdownTable(headers: string[], rows: string[][]): string {
  const lines = [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.join(' | ')} |`),
  ]
  return lines.join('\n')
}
