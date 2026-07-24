import type { Template } from '.'
import { resolve } from 'pathe'
import { pascalCase } from 'scule'

const USE_PREFIX_RE = /^use-?/

const composable: Template = ({ name, nuxtOptions }) => {
  const nameWithoutUsePrefix = name.replace(USE_PREFIX_RE, '')
  const nameWithUsePrefix = `use${pascalCase(nameWithoutUsePrefix)}`

  return {
    path: resolve(nuxtOptions.srcDir, `composables/${name}.ts`),
    contents: `
export const ${nameWithUsePrefix} = () => {
  return ref()
}
    `,
  }
}

export { composable }
