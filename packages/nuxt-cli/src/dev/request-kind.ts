import type { IncomingMessage } from 'node:http'

/** Bundler module-graph URLs (`/@id/`, `/@fs/`, `virtual:`, SFC block queries, Nuxt VFS). */
const BUNDLER_URL_RE = /^\/(?:@|__|_nuxt\/|_vfs(?:\.json)?(?:$|[/?]))|\/node_modules\/|virtual:|[?&](?:vue&type=|import(?:&|=|$)|direct(?:&|=|$)|html-proxy|raw(?:&|=|$)|worker(?:&|=|$))/

/** Whether a request is a bundler subresource rather than app traffic, by `sec-fetch-dest` or URL shape. */
export function isBundlerRequest(url: string, fetchDest?: string): boolean {
  return fetchDest === 'script' || fetchDest === 'style' || BUNDLER_URL_RE.test(url)
}

/** Whether a request is for a rendered page. */
export function isDocumentRequest(req: IncomingMessage): boolean {
  if ((req.method || 'GET') !== 'GET') {
    return false
  }
  if (!String(req.headers.accept || '').includes('text/html')) {
    return false
  }
  return !isBundlerRequest(req.url || '/', String(req.headers['sec-fetch-dest'] || '') || undefined)
}
