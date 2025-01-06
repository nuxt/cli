import type { Template } from '.'
import { resolve } from 'pathe'
import { applySuffix } from '.'

const middleware: Template = ({ name, args, nuxtOptions }) => ({
  path: resolve(nuxtOptions.srcDir, nuxtOptions.dir.middleware, `${name}${applySuffix(args, ['global'])}.ts`),
  contents: `
export default defineNuxtRouteMiddleware((to, from) => {})
`,
})

export { middleware }
