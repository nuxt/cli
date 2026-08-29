import type { Server } from 'srvx'
import { existsSync } from 'node:fs'

import { readFile } from 'node:fs/promises'

import { join } from 'pathe'
import { serve } from 'srvx'
import { staticMiddleware } from 'srvx/static'

/** Files a client-only build uses as its entry, most specific first. */
const SPA_FALLBACKS = ['200.html', 'index.html']

/** Whether a directory looks like the static output of a client-only build. */
export function findStaticEntry(dir: string): string | undefined {
  return SPA_FALLBACKS.map(name => join(dir, name)).find(path => existsSync(path))
}

export interface StaticPreviewOptions {
  dir: string
  entry: string
  port?: string
  hostname?: string
}

/**
 * Serve a build that has no server runtime: static files from disk, with every
 * unmatched path answered by the client entry so client-side routing works.
 */
export async function previewStaticOutput(options: StaticPreviewOptions): Promise<Server> {
  const server = serve({
    port: options.port,
    hostname: options.hostname,
    middleware: [staticMiddleware({ dir: options.dir })],
    async fetch() {
      return new Response(await readFile(options.entry), {
        headers: { 'content-type': 'text/html;charset=utf-8' },
      })
    },
  })
  return await server.ready()
}
