import { resolve } from 'pathe'
import { camelCase, upperFirst } from 'scule'
import type { NuxtOptions } from '@nuxt/schema'

interface TemplateOptions {
  name: string
  args: Record<string, any>
  nuxtOptions: NuxtOptions
}

interface Template {
  (options: TemplateOptions): { path: string, contents: string }
}

const httpMethods = [
  'connect',
  'delete',
  'get',
  'head',
  'options',
  'post',
  'put',
  'trace',
  'patch',
]
const api: Template = ({ name, args, nuxtOptions }) => {
  return {
    path: resolve(nuxtOptions.srcDir, nuxtOptions.serverDir, `api/${name}${applySuffix(args, httpMethods, 'method')}.ts`),
    contents: `
export default defineEventHandler((event) => {
  return 'Hello ${name}'
})
`,
  }
}

const plugin: Template = ({ name, args, nuxtOptions }) => ({
  path: resolve(nuxtOptions.srcDir, nuxtOptions.dir.plugins, `${name}${applySuffix(args, ['client', 'server'], 'mode')}.ts`),
  contents: `
export default defineNuxtPlugin((nuxtApp) => {})
  `,
})

const component: Template = ({ name, args, nuxtOptions }) => ({
  path: resolve(nuxtOptions.srcDir, `components/${name}${applySuffix(
    args,
    ['client', 'server'],
    'mode',
  )}.vue`),
  contents: `
<script setup lang="ts"></script>

<template>
  <div>
    Component: ${name}
  </div>
</template>

<style scoped></style>
`,
})

export const composable: Template = ({ name, nuxtOptions }) => {
  const nameWithoutUsePrefix = name.replace(/^use-?/, '')
  const nameWithUsePrefix = `use${upperFirst(camelCase(nameWithoutUsePrefix))}`

  return {
    path: resolve(nuxtOptions.srcDir, `composables/${name}.ts`),
    contents: `
  export const ${nameWithUsePrefix} = () => {
    return ref()
  }
    `,
  }
}

const middleware: Template = ({ name, args, nuxtOptions }) => ({
  path: resolve(nuxtOptions.srcDir, nuxtOptions.dir.middleware, `${name}${applySuffix(args, ['global'])}.ts`),
  contents: `
export default defineNuxtRouteMiddleware((to, from) => {})
`,
})

const layout: Template = ({ name, nuxtOptions }) => ({
  path: resolve(nuxtOptions.srcDir, nuxtOptions.dir.layouts, `${name}.vue`),
  contents: `
<script setup lang="ts"></script>

<template>
  <div>
    Layout: ${name}
    <slot />
  </div>
</template>

<style scoped></style>
`,
})

const page: Template = ({ name, nuxtOptions }) => ({
  path: resolve(nuxtOptions.srcDir, nuxtOptions.dir.pages, `${name}.vue`),
  contents: `
<script setup lang="ts"></script>

<template>
  <div>
    Page: ${name}
  </div>
</template>

<style scoped></style>
`,
})

const layer: Template = ({ name, nuxtOptions }) => {
  return {
    path: resolve(nuxtOptions.srcDir, `layers/${name}/nuxt.config.ts`),
    contents: `
export default defineNuxtConfig({})
`,
  }
}

export const templates = {
  api,
  plugin,
  component,
  composable,
  middleware,
  layout,
  page,
  layer,
} as Record<string, Template>

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
      suffix += '.' + s
    }
  }
  // --mode=server
  if (unwrapFrom && args[unwrapFrom] && suffixes.includes(args[unwrapFrom])) {
    suffix += '.' + args[unwrapFrom]
  }
  return suffix
}
