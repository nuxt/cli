import type { Template } from '.'
import { resolve } from 'pathe'

const serverPlugin: Template = ({ name, nuxtOptions }) => ({
  path: resolve(nuxtOptions.srcDir, nuxtOptions.serverDir, 'plugins', `${name}.ts`),
  contents: `
export default defineNitroPlugin(nitroApp => {})
`,
})

export { serverPlugin }
