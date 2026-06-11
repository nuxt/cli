// TODO: Remove this file once `templates:extend` is published in `@nuxt/schema`.

import type { HookResult, NuxtOptions } from '@nuxt/schema'

declare module '@nuxt/schema' {
  interface NuxtHooks {
    /**
     * Allows extending nuxi `add-template` code generation templates.
     *
     * The `templates` object maps template names to generator functions. Modules
     * can add new entries or override existing ones by mutating the object.
     */
    'templates:extend': (templates: Record<string, (options: {
      name: string
      args: Record<string, unknown>
      nuxtOptions: NuxtOptions
    }) => { path: string, contents: string }>) => HookResult
  }
}

export {}
