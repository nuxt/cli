import type { Template } from '.'
import { resolve } from 'pathe'

const layer: Template = ({ name, nuxtOptions }) => {
  return {
    path: resolve(nuxtOptions.srcDir, `layers/${name}/nuxt.config.ts`),
    contents: `
export default defineNuxtConfig({})
`,
  }
}

export { layer }
