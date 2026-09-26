import { isIP } from 'node:net'

/**
 * Hostname of an HTTP `Host` header: lowercased, port stripped, IPv6 brackets
 * removed. `undefined` for a value that cannot be a hostname at all.
 */
export function parseHostHeader(host: string | undefined): string | undefined {
  if (!host) {
    return undefined
  }
  const value = host.trim().toLowerCase()
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    return end > 1 ? value.slice(1, end) : undefined
  }
  const hostname = value.split(':')[0]
  return hostname || undefined
}

/**
 * Whether a socket's peer address is on this machine: the `127.0.0.0/8` range
 * or `::1`, in bracketed, zone-suffixed or IPv4-mapped form.
 */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) {
    return false
  }
  let value = address.trim().toLowerCase()
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    if (end < 2) {
      return false
    }
    value = value.slice(1, end)
  }
  const zone = value.indexOf('%')
  if (zone !== -1) {
    value = value.slice(0, zone)
  }
  if (value.startsWith('::ffff:')) {
    value = value.slice(7)
  }
  if (value === '::1') {
    return true
  }
  if (isIP(value) !== 4) {
    return false
  }
  return value.startsWith('127.')
}

/**
 * Whether a request's `Host` header names this dev server, guarding the CLI's
 * own endpoints (the progress stream, the loading page and the error page)
 * against DNS rebinding, where a hostname the attacker controls resolves to
 * this machine and a page in the developer's own browser becomes same-origin
 * with the dev server.
 *
 * IP literals are always accepted: rebinding needs a DNS name, and devices on
 * a permitted network reach a non-loopback bind by address. A missing `Host`
 * is accepted too, since it cannot come from a browser.
 */
export function isAllowedHost(host: string | undefined, allowedHosts: ReadonlySet<string>): boolean {
  if (!host) {
    return true
  }
  const hostname = parseHostHeader(host)
  if (!hostname) {
    return false
  }
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return true
  }
  if (isIP(hostname)) {
    return true
  }
  return allowedHosts.has(hostname)
}
