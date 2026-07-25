import type { Template } from '.'
import { resolve } from 'pathe'
import { camelCase } from 'scule'

const serverUtil: Template = ({ name, nuxtOptions }) => ({
  path: resolve(nuxtOptions.srcDir, nuxtOptions.serverDir, 'utils', `${name}.ts`),
  contents: `
export function ${camelCase(name)}() {}
`,
})

export { serverUtil }
