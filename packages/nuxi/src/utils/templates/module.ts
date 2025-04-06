import type { Template } from '.'
import { resolve } from 'pathe'

const module: Template = ({ name, nuxtOptions }) => ({
  path: resolve(nuxtOptions.rootDir, 'modules', `${name}.ts`),
  contents: `
import { defineNuxtModule } from 'nuxt/kit'

export default defineNuxtModule({
  meta: {
    name: '${name}'
  },
  setup () {}
})
`,
})

export { module }
