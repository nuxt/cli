import { resolve } from 'pathe'
import type { Template } from '.'

const serverMiddleware: Template = ({ name, nuxtOptions }) => ({
  path: nuxtOptions.future.compatibilityVersion === 3
    ? resolve(nuxtOptions.srcDir, nuxtOptions.serverDir, 'middleware', `${name}.ts`)
    : resolve(nuxtOptions.serverDir, 'middleware', `${name}.ts`),
  contents: `
export default defineEventHandler((event) => {})
`,
})

export { serverMiddleware }
