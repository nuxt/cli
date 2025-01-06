import type { Template } from '.'
import { resolve } from 'pathe'
import { camelCase } from 'scule'

const serverUtil: Template = ({ name, nuxtOptions }) => ({
  path: nuxtOptions.future.compatibilityVersion === 3
    ? resolve(nuxtOptions.srcDir, nuxtOptions.serverDir, 'utils', `${name}.ts`)
    : resolve(nuxtOptions.serverDir, 'utils', `${name}.ts`),
  contents: `
export function ${camelCase(name)}() {}
`,
})

export { serverUtil }
