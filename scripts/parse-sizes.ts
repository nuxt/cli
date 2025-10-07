import { readFileSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

interface RollupStatsNode {
  renderedLength?: number
  gzipLength?: number
  brotliLength?: number
}

interface RollupStats {
  nodeParts?: Record<string, RollupStatsNode>
}

interface BundleSize {
  rendered: number
  gzip: number
  brotli: number
}

interface PackageComparison {
  name: string
  base: BundleSize
  head: BundleSize
  diff: {
    rendered: number
    gzip: number
    brotli: number
  }
  error?: string
}

/**
 * Calculate total size from Rollup stats
 */
function calculateTotalSize(stats: RollupStats): BundleSize {
  if (!stats.nodeParts) {
    return { rendered: 0, gzip: 0, brotli: 0 }
  }

  let totalRendered = 0
  let totalGzip = 0
  let totalBrotli = 0

  for (const node of Object.values(stats.nodeParts)) {
    totalRendered += node.renderedLength || 0
    totalGzip += node.gzipLength || 0
    totalBrotli += node.brotliLength || 0
  }

  return { rendered: totalRendered, gzip: totalGzip, brotli: totalBrotli }
}

/**
 * Format bytes to KB with 2 decimal places
 */
function formatBytes(bytes: number): string {
  return (bytes / 1024).toFixed(2)
}

/**
 * Format diff with sign and percentage
 */
function formatDiff(diff: number, base: number): { icon: string, sign: string, percent: string } {
  const percent = base ? ((diff / base) * 100).toFixed(2) : '0.00'
  const sign = diff > 0 ? '+' : ''
  const icon = diff > 0 ? '📈' : diff < 0 ? '📉' : '➡️'
  return { icon, sign, percent }
}

/**
 * Compare sizes for a single package
 */
function comparePackage(name: string, headPath: string, basePath: string): PackageComparison {
  try {
    const headStats: RollupStats = JSON.parse(readFileSync(headPath, 'utf8'))
    const baseStats: RollupStats = JSON.parse(readFileSync(basePath, 'utf8'))

    const head = calculateTotalSize(headStats)
    const base = calculateTotalSize(baseStats)

    return {
      name,
      base,
      head,
      diff: {
        rendered: head.rendered - base.rendered,
        gzip: head.gzip - base.gzip,
        brotli: head.brotli - base.brotli,
      },
    }
  }
  catch (error) {
    return {
      name,
      base: { rendered: 0, gzip: 0, brotli: 0 },
      head: { rendered: 0, gzip: 0, brotli: 0 },
      diff: { rendered: 0, gzip: 0, brotli: 0 },
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Generate markdown comment for size comparison
 */
export function generateSizeComment(packages: string[], statsDir = process.cwd()): string {
  let commentBody = '## 📦 Bundle Size Comparison\n\n'

  for (const pkg of packages) {
    const headPath = `${statsDir}/head-stats/${pkg}/stats.json`
    const basePath = `${statsDir}/base-stats/${pkg}/stats.json`

    const comparison = comparePackage(pkg, headPath, basePath)

    if (comparison.error) {
      console.error(`Error processing ${pkg}:`, comparison.error)
      commentBody += `### ⚠️ **${pkg}**\n\nCould not compare sizes: ${comparison.error}\n\n`
      continue
    }

    const { icon, sign, percent } = formatDiff(comparison.diff.rendered, comparison.base.rendered)

    commentBody += `### ${icon} **${pkg}**\n\n`
    commentBody += `| Metric | Base | Head | Diff |\n`
    commentBody += `|--------|------|------|------|\n`
    commentBody += `| Rendered | ${formatBytes(comparison.base.rendered)} KB | ${formatBytes(comparison.head.rendered)} KB | ${sign}${formatBytes(comparison.diff.rendered)} KB (${sign}${percent}%) |\n`

    if (comparison.base.gzip > 0 || comparison.head.gzip > 0) {
      const gzipFmt = formatDiff(comparison.diff.gzip, comparison.base.gzip)
      commentBody += `| Gzip | ${formatBytes(comparison.base.gzip)} KB | ${formatBytes(comparison.head.gzip)} KB | ${gzipFmt.sign}${formatBytes(comparison.diff.gzip)} KB (${gzipFmt.sign}${gzipFmt.percent}%) |\n`
    }

    commentBody += '\n'
  }

  return commentBody
}

// CLI usage
const isMainModule = process.argv[1] && (
  import.meta.url === `file://${process.argv[1]}`
    || import.meta.url.endsWith(process.argv[1])
)

if (isMainModule) {
  const packages = process.argv.slice(2)
  if (packages.length === 0) {
    console.error('Usage: node scripts/parse-sizes.ts <package1> <package2> ...')
    console.error('')
    console.error('Example: node scripts/parse-sizes.ts nuxi nuxt-cli create-nuxt')
    process.exit(1)
  }

  const rootDir = fileURLToPath(new URL('..', import.meta.url))
  const comment = generateSizeComment(packages, rootDir)
  console.log(comment)
}
