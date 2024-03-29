import { upperFirst } from 'scule'
import type { Template } from '.'

const composable: Template = ({ name }) => {
  const nameWithUsePrefix = name.startsWith('use')
    ? name
    : `use${upperFirst(name)}`
  return {
    path: `composables/${name}.ts`,
    contents: `
export const ${nameWithUsePrefix} = () => {
  return ref()
}
  `,
  }
}

export { composable }
