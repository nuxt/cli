import type { ArgDef } from 'citty'

export const cwdArgs = {
  cwd: {
    type: 'string',
    description: 'Specify the root directory of your Nuxt project',
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

export const profileArgs = {
  profile: {
    type: 'string',
    description: 'Profile performance. Use --profile for CPU only, --profile=verbose for full report.',
    default: undefined as string | undefined,
    valueHint: 'verbose',
  },
} as const satisfies Record<string, ArgDef>

/**
 * `--cwd` is deliberately not declared here: it is an undocumented alias for ROOTDIR,
 * normalised out of `rawArgs` by `normaliseCwdArg` and read back off `args.cwd`.
 * No default, so `resolveRootDir` can tell an explicit ROOTDIR from an absent one.
 */
export const rootDirArgs = {
  rootDir: {
    type: 'positional',
    description: 'The root directory of your Nuxt project (default: .)',
    required: false,
    default: undefined,
  },
} as const satisfies Record<string, ArgDef>
