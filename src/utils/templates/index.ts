import { api } from './api'
import { app } from './app'
import { component } from './component'
import { composable } from './composable'
import { error } from './error'
import { layer } from './layer'
import { layout } from './layout'
import { middleware } from './middleware'
import { page } from './page'
import { plugin } from './plugin'
import { serverMiddleware } from './server-middleware'
import type { NuxtOptions } from '@nuxt/schema'

interface TemplateOptions {
  name: string
  args: Record<string, any>
  nuxtOptions: NuxtOptions
}

interface Template {
  (options: TemplateOptions): { path: string, contents: string }
}

const templates: Record<string, Template> = {
  api,
  app,
  component,
  composable,
  error,
  layer,
  layout,
  middleware,
  page,
  plugin,
  'server-middleware': serverMiddleware,
}

// -- internal utils --

function applySuffix(
  args: TemplateOptions['args'],
  suffixes: string[],
  unwrapFrom?: string,
): string {
  let suffix = ''

  // --client
  for (const s of suffixes) {
    if (args[s]) {
      suffix += `.${s}`
    }
  }

  // --mode=server
  if (unwrapFrom && args[unwrapFrom] && suffixes.includes(args[unwrapFrom])) {
    suffix += `.${args[unwrapFrom]}`
  }

  return suffix
}

export { templates, applySuffix, Template }
