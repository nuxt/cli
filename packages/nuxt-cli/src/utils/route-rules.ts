import { styleText } from 'node:util'

import { truncate, visibleWidth } from './formatting'

type RouteRule = Record<string, any>

/** Rows listed before the rest are counted, as the client bundle summary does for chunks. */
const MAX_ROUTES = 20

/** Rules Nuxt adds for its own endpoints, which say nothing about the app. */
const INTERNAL_ROUTES = new Set(['/__nuxt_error'])

export interface FormatRouteRulesOptions {
  /** Nuxt's `app.buildAssetsDir`, whose cache headers Nuxt and Nitro set on their own. */
  buildAssetsDir?: string
  /** Nitro's `publicAssets`, whose directories Nitro gives a cache header rule of their own. */
  publicAssets?: { baseURL?: string, maxAge?: number }[]
  /** Width to truncate rows to. */
  columns?: number
}

/** Headers Nitro adds for `cors: true`, shown as `cors` rather than one by one. */
const CORS_HEADERS = new Set([
  'access-control-allow-origin',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-max-age',
])

/** Rule keys given their own label; any other key is listed as it is. */
const KNOWN_KEYS = new Set(['prerender', 'ssr', 'isr', 'swr', 'cache', 'redirect', 'proxy', 'cors', 'headers', 'appMiddleware'])

function seconds(value: unknown): string {
  return typeof value === 'number' ? ` ${value}s` : ''
}

/** Nitro 2 names the redirect code `statusCode`, Nitro 3 `status`. */
function target(value: { to?: string, status?: number, statusCode?: number }): string {
  const status = value.status ?? value.statusCode
  return `${value.to}${status ? styleText('dim', ` (${status})`) : ''}`
}

/** One route's rules as short labels, in the order a reader weighs them: rendering, caching, routing, headers. */
export function describeRouteRule(rule: RouteRule): string[] {
  const labels: string[] = []

  // A route that redirects or proxies renders nothing, so opting it out of prerendering says nothing.
  if (rule.prerender || (rule.prerender === false && !rule.redirect && !rule.proxy)) {
    labels.push(rule.prerender ? 'prerender' : 'prerender: false')
  }
  if (rule.ssr === false) {
    labels.push('ssr: false')
  }
  if (rule.isr !== undefined && rule.isr !== false) {
    labels.push(`isr${seconds(typeof rule.isr === 'object' ? rule.isr.expiration : rule.isr)}`)
  }
  // Nitro 2 keeps `swr` next to the `cache` it expands to; Nitro 3 only keeps `cache`.
  if (rule.swr || rule.cache?.swr) {
    labels.push(`swr${seconds(typeof rule.swr === 'number' ? rule.swr : rule.cache?.maxAge)}`)
  }
  else if (rule.cache === false) {
    labels.push('cache: false')
  }
  else if (rule.cache) {
    labels.push(`cache${seconds(rule.cache.maxAge)}`)
  }
  if (rule.redirect) {
    labels.push(`redirect → ${target(rule.redirect)}`)
  }
  if (rule.proxy) {
    labels.push(`proxy → ${target(rule.proxy)}`)
  }
  if (rule.cors) {
    labels.push('cors')
  }
  const headers = Object.keys(rule.headers || {}).filter(name => !rule.cors || !CORS_HEADERS.has(name))
  if (headers.length) {
    labels.push(`headers: ${headers.join(', ')}`)
  }
  const middleware = Object.entries(rule.appMiddleware || {})
  if (middleware.length) {
    labels.push(`middleware: ${middleware.map(([name, enabled]) => enabled ? name : `-${name}`).join(', ')}`)
  }

  for (const [key, value] of Object.entries(rule)) {
    if (KNOWN_KEYS.has(key) || value === undefined) {
      continue
    }
    labels.push(value === true ? key : `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
  }
  return labels
}

/**
 * Nuxt renames unnamed segments of page rules to `:_<index>` so that patterns
 * sharing a prefix agree on parameter names; written back as the `*` they were.
 */
function displayRoute(route: string): string {
  return route.replace(/\/:_\d+_*(?=\/|$)/g, '/*')
}

/** Whether `route` is the cache header rule Nitro adds for a public asset directory with a `maxAge`. */
function isPublicAssetRule(route: string, rule: RouteRule, publicAssets: FormatRouteRulesOptions['publicAssets'] = []): boolean {
  const headers = Object.keys(rule.headers || {})
  if (Object.keys(rule).some(key => key !== 'headers' && rule[key] !== undefined) || headers.length !== 1 || headers[0]!.toLowerCase() !== 'cache-control') {
    return false
  }
  const normalised = route.replace(/\/{2,}/g, '/')
  return publicAssets.some(asset => asset.maxAge && normalised === `${(asset.baseURL || '/').replace(/\/+$/, '')}/**`)
}

/** Whether `route` only exists because Nuxt mirrored a cached page's rules onto its payload. */
function isDerivedPayloadRoute(route: string, routes: Set<string>): boolean {
  if (!route.endsWith('/_payload.json')) {
    return false
  }
  return routes.has(route.slice(0, -'/_payload.json'.length) || '/')
}

/** `items` joined by commas, as many as fit in `width`, then a count of the rest. */
function fitList(items: string[], width: number): string {
  const separator = styleText('dim', ', ')
  let fitted = ''
  for (const [index, item] of items.entries()) {
    const next = fitted ? `${fitted}${separator}${styleText('cyan', item)}` : styleText('cyan', item)
    const more = items.length - index - 1
    if (fitted && visibleWidth(`${next}${more ? `, +${more} more` : ''}`) > width) {
      return `${fitted}${styleText('dim', `, +${items.length - index} more`)}`
    }
    fitted = next
  }
  return fitted
}

/** A column `width` wide, cutting what does not fit. */
function cell(text: string, width: number): string {
  const cut = truncate(text, width)
  return cut + ' '.repeat(width - visibleWidth(cut))
}

/**
 * The app's resolved route rules as a two-column table, or an empty string when
 * it has none worth listing. Up to 20 routes are listed one per row; past that,
 * routes that share their rules share a row, so the table stays a screen high.
 */
export function formatRouteRules(routeRules: Record<string, object> | undefined, options: FormatRouteRulesOptions = {}): string {
  const columns = options.columns ?? 80
  const assetsDir = options.buildAssetsDir ? `/${options.buildAssetsDir.replace(/^\/+|\/+$/g, '')}` : undefined
  const routes = new Set(Object.keys(routeRules || {}))
  const rows = Object.entries(routeRules || {})
    .filter(([route, rule]) => !INTERNAL_ROUTES.has(route)
      && !(assetsDir && (route === assetsDir || route.startsWith(`${assetsDir}/`)))
      && !isPublicAssetRule(route, rule as RouteRule, options.publicAssets)
      && !isDerivedPayloadRoute(route, routes))
    .map(([route, rule]) => ({ route: displayRoute(route), labels: describeRouteRule(rule as RouteRule) }))
    .filter(row => row.labels.length)
    .sort((a, b) => a.route.localeCompare(b.route))

  if (!rows.length) {
    return ''
  }

  const title = `${styleText('bold', 'Route rules')}  ${styleText('dim', `${rows.length} ${rows.length === 1 ? 'route' : 'routes'}`)}`
  // The first column takes at most 40% of the width, so a long route or rule,
  // such as one a module generates, cannot push the second column off screen.
  const maxWidth = Math.max(16, Math.floor(columns * 0.4))

  if (rows.length <= MAX_ROUTES) {
    const width = Math.min(Math.max('Route'.length, ...rows.map(row => visibleWidth(row.route))), maxWidth)
    return [
      title,
      '',
      styleText('dim', `${cell('Route', width)}  Rules`),
      ...rows.map(row => `${styleText('cyan', cell(row.route, width))}  ${row.labels.join(styleText('dim', ', '))}`),
    ].map(line => truncate(line, columns)).join('\n')
  }

  // Each redirect has its own target, so redirects are grouped on the rule alone.
  const groups = new Map<string, string[]>()
  for (const row of rows) {
    const key = row.labels.map(label => label.startsWith('redirect → ') ? 'redirect' : label).join(styleText('dim', ', '))
    groups.set(key, [...(groups.get(key) || []), row.route])
  }
  const sorted = [...groups].sort(([a, x], [b, y]) => y.length - x.length || a.localeCompare(b))
  const shown = sorted.slice(0, MAX_ROUTES)
  const rest = sorted.slice(MAX_ROUTES)
  const width = Math.min(Math.max('Rules'.length, ...shown.map(([labels]) => visibleWidth(labels))), maxWidth)
  const lines = [
    title,
    '',
    styleText('dim', `${cell('Rules', width)}  Routes`),
    ...shown.map(([labels, list]) => `${cell(labels, width)}  ${fitList(list, columns - width - 2)}`),
  ]
  if (rest.length) {
    const count = rest.reduce((sum, [, list]) => sum + list.length, 0)
    lines.push(styleText('dim', `+${rest.length} more rules on ${count} ${count === 1 ? 'route' : 'routes'}`))
  }
  return lines.map(line => truncate(line, columns)).join('\n')
}
