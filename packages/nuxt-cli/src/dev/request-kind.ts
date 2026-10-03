import type { IncomingMessage } from 'node:http'

/** Vite/webpack module-graph URLs: `/@id/...`, `/@fs/...`, `virtual:` modules, SFC block queries, plus Nuxt's dev-only virtual file system endpoint. */
const BUNDLER_URL_RE = /^\/(?:@|__|_nuxt\/|_vfs(?:\.json)?(?:$|[/?]))|\/node_modules\/|virtual:|[?&](?:vue&type=|import(?:&|=|$)|direct(?:&|=|$)|html-proxy|raw(?:&|=|$)|worker(?:&|=|$))/

/**
 * Whether a request is the bundler talking to itself rather than the app being
 * used. There is no dedicated header, but in dev every script and style
 * subresource is served through the bundler pipeline, so `sec-fetch-dest`
 * identifies most of it and the URL shape catches the rest.
 */
export function isBundlerRequest(url: string, fetchDest?: string): boolean {
  return fetchDest === 'script' || fetchDest === 'style' || BUNDLER_URL_RE.test(url)
}

/**
 * Whether a request is one the app renders a page for, rather than the bundler
 * fetching a module or a client asking for data.
 */
export function isDocumentRequest(req: IncomingMessage): boolean {
  if ((req.method || 'GET') !== 'GET') {
    return false
  }
  if (!String(req.headers.accept || '').includes('text/html')) {
    return false
  }
  return !isBundlerRequest(req.url || '/', String(req.headers['sec-fetch-dest'] || '') || undefined)
}
