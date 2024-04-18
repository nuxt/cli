import type { Template } from '.'
import { applySuffix } from '.'

const plugin: Template = ({ name, args }) => ({
  path: `plugins/${name}${applySuffix(args, ['client', 'server'], 'mode')}.ts`,
  contents: `
export default defineNuxtPlugin((nuxtApp) => {})
  `,
})

export { plugin }
