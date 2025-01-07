import type { Template } from '.'
import { resolve } from 'pathe'

const serverMiddleware: Template = ({ name, nuxtOptions }) => ({
  path: resolve(nuxtOptions.srcDir, nuxtOptions.serverDir, 'middleware', `${name}.ts`),
  contents: `
export default defineEventHandler(event => {})
`,
})

export { serverMiddleware }
