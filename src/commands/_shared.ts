import type { ArgDef } from 'citty'

export const cwdArgs = {
  cwd: {
    type: 'string',
    description: 'Specify the working directory, defaults to current directory (".")',
    valueHint: 'directory',
    default: '.',
  },
} as const satisfies Record<string, ArgDef>

export const sharedArgs = {
  ...cwdArgs,
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

export const legacyRootDirArgs = {
  // cwd falls back to rootDir's default (indirect default) to ease migration
  cwd: {
    ...cwdArgs.cwd,
    description: 'Specify the working directory, falls back to ROOTDIR if unset (defaults to current directory (".") after ROOTDIR argument removal)',
    default: undefined,
  },
  rootDir: {
    type: 'positional',
    description: '(DEPRECATED) Use `--cwd` instead. Specifies the working directory, defaults to current directory (".")',
    required: false,
    default: '.',
  },
} as const satisfies Record<string, ArgDef>
