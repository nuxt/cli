import type { Template } from '.'
import { resolve } from 'pathe'
import { applySuffix } from '.'
import { httpMethods } from './modifiers'

const api: Template = ({ name, args, nuxtOptions }) => {
  return {
    path: resolve(nuxtOptions.srcDir, nuxtOptions.serverDir, `api/${name}${applySuffix(args, httpMethods, 'method')}.ts`),
    contents: `
export default defineEventHandler(event => {
  return 'Hello ${name}'
})
`,
  }
}

export { api }
