import type { ArgDef } from 'citty'

export const cwdArgs = {
  cwd: {
    type: 'string',
    description: 'Specify the working directory',
    valueHint: 'directory',
    default: '.',
  },
} as const satisfies Record<string, ArgDef>

export const logLevelArgs = {
  logLevel: {
    type: 'string',
    description: 'Specify build-time log level',
    valueHint: 'silent|info|verbose',
  },
} as const satisfies Record<string, ArgDef>

export const envNameArgs = {
  envName: {
    type: 'string',
    description: 'The environment to use when resolving configuration overrides (default is `production` when building, and `development` when running the dev server)',
  },
} as const satisfies Record<string, ArgDef>

export const dotEnvArgs = {
  dotenv: {
    type: 'string',
    description: 'Path to `.env` file to load, relative to the root directory',
  },
} as const satisfies Record<string, ArgDef>

export const extendsArgs = {
  extends: {
    type: 'string',
    description: 'Extend from a Nuxt layer',
    valueHint: 'layer-name',
    alias: ['e'],
  },
} as const satisfies Record<string, ArgDef>

export const legacyRootDirArgs = {
  // cwd falls back to rootDir's default (indirect default)
  cwd: {
    ...cwdArgs.cwd,
    description: 'Specify the working directory, this takes precedence over ROOTDIR (default: `.`)',
    default: undefined,
  },
  rootDir: {
    type: 'positional',
    description: 'Specifies the working directory (default: `.`)',
    required: false,
    default: '.',
  },
} as const satisfies Record<string, ArgDef>
