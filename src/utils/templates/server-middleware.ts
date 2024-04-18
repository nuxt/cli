import type { Template } from '.'

const serverMiddleware: Template = ({ name }) => ({
  path: `server/middleware/${name}.ts`,
  contents: `
export default defineEventHandler((event) => {})
`,
})

export { serverMiddleware }
