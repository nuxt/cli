import type { Template } from '.'
import { resolve } from 'pathe'
import { applySuffix } from '.'

const plugin: Template = ({ name, args, nuxtOptions }) => ({
  path: resolve(nuxtOptions.srcDir, nuxtOptions.dir.plugins, `${name}${applySuffix(args, ['client', 'server'], 'mode')}.ts`),
  contents: `
export default defineNuxtPlugin((nuxtApp) => {})
  `,
})

export { plugin }
