import type { CommandMeta } from 'citty'

import type { commands } from '.'

export const commandMeta = {
  'add': {
    name: 'add',
    description: 'Add Nuxt modules and layers',
  },
  'add-template': {
    name: 'add-template',
    description: 'Create a new template file.',
  },
  'analyze': {
    name: 'analyze',
    description: 'Build Nuxt and analyze production bundle (experimental)',
  },
  'build': {
    name: 'build',
    description: 'Build Nuxt for production deployment',
  },
  'cleanup': {
    name: 'cleanup',
    description: 'Clean up generated Nuxt files and caches',
  },
  'curl': {
    name: 'curl',
    description: 'Send an HTTP request to your running Nuxt dev server',
  },
  '_dev': {
    name: '_dev',
    description: 'Run Nuxt development server (internal command to start child process)',
    hidden: true,
  },
  'dev': {
    name: 'dev',
    description: 'Run Nuxt development server',
  },
  'devtools': {
    name: 'devtools',
    description: 'Enable or disable devtools in a Nuxt project',
  },
  'docs': {
    name: 'docs',
    description: 'Search or open the Nuxt documentation',
  },
  'generate': {
    name: 'generate',
    description: 'Build Nuxt and prerender all routes',
  },
  'info': {
    name: 'info',
    description: 'Get information about Nuxt project',
  },
  'init': {
    name: 'init',
    description: 'Scaffold a fresh project (moved to create-nuxt)',
    hidden: true,
  },
  'module': {
    name: 'module',
    description: 'Manage Nuxt modules',
  },
  'prepare': {
    name: 'prepare',
    description: 'Prepare Nuxt for development/build',
  },
  'preview': {
    name: 'preview',
    description: 'Launches Nitro server for local testing after `nuxt build`.',
  },
  'start': {
    name: 'start',
    description: 'Launches Nitro server for local testing after `nuxt build`.',
    hidden: true,
  },
  'task': {
    name: 'task',
    description: 'List and run Nitro tasks on your dev server',
  },
  'test': {
    name: 'test',
    description: 'Run tests',
  },
  'typecheck': {
    name: 'typecheck',
    description: 'Runs type-checking throughout your app using `vue-tsc` or Golar.',
  },
  'upgrade': {
    name: 'upgrade',
    description: 'Upgrade Nuxt',
  },
} as const satisfies Record<keyof typeof commands, CommandMeta>
