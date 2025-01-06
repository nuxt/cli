import type { Template } from '.'
import { resolve } from 'pathe'
import { camelCase, upperFirst } from 'scule'

const composable: Template = ({ name, nuxtOptions }) => {
  const nameWithoutUsePrefix = name.replace(/^use-?/, '')
  const nameWithUsePrefix = `use${upperFirst(camelCase(nameWithoutUsePrefix))}`

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
