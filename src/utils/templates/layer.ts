import { resolve } from "pathe"
import { Template } from "."

const layer: Template = ({ name, nuxtOptions }) => {
  return {
    path: resolve(nuxtOptions.srcDir, `layers/${name}/nuxt.config.ts`),
    contents: `
export default defineNuxtConfig({})
`,
  }
}

export { layer }