import type { Template } from '.'
import { applySuffix } from '.'

const middleware: Template = ({ name, args }) => ({
  path: `middleware/${name}${applySuffix(args, ['global'])}.ts`,
  contents: `
export default defineNuxtRouteMiddleware((to, from) => {})
`,
})

export { middleware }
