import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  declaration: true,
  rollup: {
    inlineDependencies: true,
    resolve: {
      exportConditions: ['production', 'node'] as any,
    },
  },
  entries: [
    'src/index', 
    'src/utils/index'
  ],
  externals: [
    '@nuxt/kit',
    '@nuxt/schema',
    '@nuxt/test-utils',
    'fsevents',
    'listhen',
    'node:url',
    'node:buffer',
    'node:path',
    'node:child_process',
    'node:process',
    'node:path',
    'node:os',
  ],
})
