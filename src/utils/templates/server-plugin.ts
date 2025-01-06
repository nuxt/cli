import type { Template } from '.'
import { resolve } from 'pathe'

const serverPlugin: Template = ({ name, nuxtOptions }) => ({
  path: nuxtOptions.future.compatibilityVersion === 3
    ? resolve(nuxtOptions.srcDir, nuxtOptions.serverDir, 'plugins', `${name}.ts`)
    : resolve(nuxtOptions.serverDir, 'plugins', `${name}.ts`),
  contents: `
export default defineNitroPlugin(nitroApp => {})
`,
})

export { serverPlugin }
