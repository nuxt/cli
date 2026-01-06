import type { NuxtOptions } from '@nuxt/schema'
import { api } from './api'
import { app } from './app'
import { appConfig } from './app-config'
import { component } from './component'
import { composable } from './composable'
import { error } from './error'
import { layer } from './layer'
import { layout } from './layout'
import { middleware } from './middleware'
import { module } from './module'
import { page } from './page'
import { plugin } from './plugin'
import { serverMiddleware } from './server-middleware'
import { serverPlugin } from './server-plugin'
import { serverRoute } from './server-route'
import { serverUtil } from './server-util'

interface TemplateOptions {
  name: string
  args: Record<string, any>
  nuxtOptions: NuxtOptions
}

interface Template {
  (options: TemplateOptions): { path: string, contents: string }
}

const templates = {
  'api': api,
  'app': app,
  'app-config': appConfig,
  'component': component,
  'composable': composable,
  'error': error,
  'layer': layer,
  'layout': layout,
  'middleware': middleware,
  'module': module,
  'page': page,
  'plugin': plugin,
  'server-middleware': serverMiddleware,
  'server-plugin': serverPlugin,
  'server-route': serverRoute,
  'server-util': serverUtil,
} satisfies Record<string, Template>

const _templateNames: Record<keyof typeof templates, undefined> = {
  'api': undefined,
  'app': undefined,
  'app-config': undefined,
  'component': undefined,
  'composable': undefined,
  'error': undefined,
  'layer': undefined,
  'layout': undefined,
  'middleware': undefined,
  'module': undefined,
  'page': undefined,
  'plugin': undefined,
  'server-middleware': undefined,
  'server-plugin': undefined,
  'server-route': undefined,
  'server-util': undefined,
}

export const templateNames = Object.keys(_templateNames)

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

export { applySuffix, Template, templates }
