import type { Template } from '.'
import { applySuffix } from '.'
import { resolve } from 'pathe'

const plugin: Template = ({ name, args, nuxtOptions }) => ({
  path: resolve(nuxtOptions.srcDir, nuxtOptions.dir.plugins, `${name}${applySuffix(args, ['client', 'server'], 'mode')}.ts`),
  contents: `
export default defineNuxtPlugin((nuxtApp) => {})
  `,
})

export { plugin }
