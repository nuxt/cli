import { applySuffix } from '.'
import type { Template } from '.'

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

const api: Template = ({ name, args }) => ({
  path: `server/api/${name}${applySuffix(args, httpMethods, 'method')}.ts`,
  contents: `
export default defineEventHandler((event) => {
  return 'Hello ${name}'
})
`,
})

export { api }
