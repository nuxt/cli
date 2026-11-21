import { defineModuleBuilderCommand } from './_builder'

export default defineModuleBuilderCommand('build', 'Build a module for publishing', {
  outDir: {
    type: 'string',
    valueHint: 'directory',
    description: 'Output directory, relative to the module root (default: `dist`)',
  },
  sourcemap: {
    type: 'boolean',
    description: 'Emit source maps',
  },
})
