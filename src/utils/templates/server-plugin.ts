import { resolve } from 'pathe'
import type { Template } from '.'

const serverPlugin: Template = ({ name, nuxtOptions }) => ({
  path: nuxtOptions.future.compatibilityVersion === 3
    ? resolve(nuxtOptions.srcDir, nuxtOptions.serverDir, 'plugins', `${name}.ts`)
    : resolve(nuxtOptions.serverDir, 'plugins', `${name}.ts`),
  contents: `
export default defineNitroPlugin((nitroApp) => {})
`,
})

export { serverPlugin }
