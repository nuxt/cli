import type { DevRoute, DevRoutes } from '../utils'
import type { Key } from './keys'

import type { OverlayEntry } from './screen'
import { relative } from 'node:path'

import { styleText } from 'node:util'

import { link } from 'clickable-path'

import { formatHints, ScreenOverlay } from './screen'
import { truncate } from './width'

type RouteFilter = 'all' | 'page' | 'server'

/**
 * The routes the app defines, otherwise only discoverable by reading the file
 * tree or opening DevTools in a browser.
 */
export class RouteOverlay extends ScreenOverlay {
  #routes: DevRoute[] = []
  #errorComponent?: string
  #listeners = new Set<() => void>()
  #filter: RouteFilter = 'all'
  #cwd: string

  constructor(write: (chunk: string) => void, onClose: () => void, cwd: string) {
    super({
      write,
      onClose,
      subscribe: (listener) => {
        this.#listeners.add(listener)
        return () => this.#listeners.delete(listener)
      },
    })
    this.#cwd = cwd
  }

  /**
   * The file that serves `url`, matching the most specific route first so a
   * server handler wins over the page that shares its prefix.
   */
  fileFor(url: string): string | undefined {
    const path = url.split('?')[0] ?? url
    const matches = this.#routes
      .filter(route => route.file && matchesRoute(route.route, path))
      .sort((a, b) => b.route.length - a.route.length)
    return matches[0]?.file
  }

  /** The component that renders error responses, if the app reported one. */
  get errorComponent(): string | undefined {
    return this.#errorComponent
  }

  /** Replace the known routes; the app re-reports them on every reload. */
  setRoutes({ routes, errorComponent }: DevRoutes): void {
    this.#routes = routes
    this.#errorComponent = errorComponent
    for (const listener of this.#listeners) {
      listener()
    }
  }

  protected get closeKeys(): readonly string[] {
    return ['p']
  }

  protected handleViewKey(key: Key): boolean {
    switch (key.name) {
      case 'a':
        return this.#setFilter('all')
      case 'w':
        return this.#setFilter('page')
      case 's':
        return this.#setFilter('server')
      default:
        return false
    }
  }

  protected renderTitle(): string {
    const pages = this.#routes.filter(route => route.kind === 'page').length
    const server = this.#routes.length - pages
    const counts = styleText('dim', `${pages} pages · ${server} server`)
    const label = this.#filter === 'all' ? 'all' : `${this.#filter} only`
    return ` ${styleText('bold', 'routes')} · ${label} · ${counts}${this.renderPosition()}${this.renderSearch()}`
  }

  protected renderEntries(columns: number): OverlayEntry[] {
    const matching = this.#matching()
    if (!matching.length) {
      return [{ lines: [styleText('dim', this.#routes.length ? 'no routes match this filter' : 'waiting for routes…')] }]
    }
    const width = Math.min(50, Math.max(...matching.map(route => route.route.length)) + 2)
    return matching.map(route => ({
      lines: [this.#formatRoute(route, width, columns)],
      copy: route.file ? relative(this.#cwd, route.file) : route.route,
    }))
  }

  protected renderHints(columns: number): string {
    return formatHints([
      ['↑/↓', 'select'],
      ['w', 'pages'],
      ['s', 'server'],
      ['a', 'all'],
      ['/', 'search'],
      ['enter', 'copy'],
      ['q', 'close'],
    ], columns)
  }

  #formatRoute(route: DevRoute, width: number, columns: number): string {
    const kind = route.kind === 'page'
      ? styleText('cyan', 'page  ')
      : styleText('magenta', (route.method?.toUpperCase() ?? 'all').padEnd(6))
    const path = route.route.padEnd(width)
    const file = route.file ? relative(this.#cwd, route.file) : ''
    // The tail of a path identifies it; the head is the part every row shares.
    const room = columns - width - 10
    const label = room < 8 ? '' : file.length > room ? `…${file.slice(1 - room)}` : file
    const target = label && route.file ? link(route.file, { cwd: this.#cwd, formatter: () => label }) : label
    return truncate(`  ${kind} ${path} ${styleText('dim', target)}`, columns)
  }

  #matching(): DevRoute[] {
    const query = this.query
    return this.#routes
      .filter(route => this.#filter === 'all' || route.kind === this.#filter)
      .filter(route => !query || `${route.route} ${route.file ?? ''}`.toLowerCase().includes(query))
      .sort((a, b) => a.route.localeCompare(b.route))
  }

  #setFilter(filter: RouteFilter): boolean {
    this.#filter = this.#filter === filter ? 'all' : filter
    this.resetScroll()
    return true
  }
}

/** Whether a route pattern covers `path`, including `:param` and `**` segments. */
function matchesRoute(route: string, path: string): boolean {
  if (route === path) {
    return true
  }
  const pattern = route
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\/\*\*.*$/, '(?:/.*)?')
    .replace(/:\w+/g, '[^/]+')
  return new RegExp(`^${pattern}/?$`).test(path)
}
