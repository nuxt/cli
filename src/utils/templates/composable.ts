import { resolve } from 'pathe'
import { camelCase, upperFirst } from 'scule'
import type { Template } from '.'

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
