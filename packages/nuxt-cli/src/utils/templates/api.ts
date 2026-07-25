import type { Template } from '.'
import { resolve } from 'pathe'
import { applySuffix } from '.'

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
export default defineEventHandler(event => {
  return 'Hello ${name}'
})
`,
  }
}

export { api }
