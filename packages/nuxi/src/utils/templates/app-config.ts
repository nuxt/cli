import type { Template } from '.'
import { resolve } from 'pathe'

const appConfig: Template = ({ nuxtOptions }) => ({
  path: resolve(nuxtOptions.srcDir, 'app.config.ts'),
  contents: `
export default defineAppConfig({})
`,
})

export { appConfig }
