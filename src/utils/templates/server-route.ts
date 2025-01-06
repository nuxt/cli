import type { Template } from '.'
import { resolve } from 'pathe'

const serverRoute: Template = ({ name, args, nuxtOptions }) => ({
  path: nuxtOptions.future.compatibilityVersion === 3
    ? resolve(nuxtOptions.srcDir, nuxtOptions.serverDir, args.api ? 'api' : 'routes', `${name}.ts`)
    : resolve(nuxtOptions.serverDir, args.api ? 'api' : 'routes', `${name}.ts`),
  contents: `
export default defineEventHandler((event) => {})
`,
})

export { serverRoute }
