import { resolve } from 'pathe'
import type { Template } from '.'
import { pascalCase } from 'scule'

const serverUtil: Template = ({ name, nuxtOptions }) => ({
  path: nuxtOptions.future.compatibilityVersion === 3
    ? resolve(nuxtOptions.srcDir, nuxtOptions.serverDir, 'utils', `${name}.ts`)
    : resolve(nuxtOptions.serverDir, 'utils', `${name}.ts`),
  contents: `
export function ${pascalCase(name)}() {}
`,
})

export { serverUtil }
