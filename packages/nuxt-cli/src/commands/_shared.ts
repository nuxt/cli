import type { ArgDef } from 'citty'

export const cwdArgs = {
  cwd: {
    type: 'string',
    description: 'Specify the root directory of your Nuxt project',
    valueHint: 'directory',
    default: '.',
  },
} as const satisfies Record<string, ArgDef>

/**
 * The root command's `--cwd`, forwarded to every subcommand so it can be passed
 * before the command name.
 *
 * No default, unlike {@link cwdArgs}: commands taking a ROOTDIR positional treat an
 * explicit `--cwd` as an override of it, and cannot tell the two apart if it is
 * always set.
 */
export const globalCwdArgs = {
  cwd: {
    ...cwdArgs.cwd,
    default: undefined as string | undefined,
    inherit: true,
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
    valueHint: 'environment',
  },
} as const satisfies Record<string, ArgDef>

export const dotEnvArgs = {
  dotenv: {
    type: 'string',
    description: 'Path to `.env` file to load, relative to the root directory. Can be repeated, with later files taking precedence.',
    valueHint: 'path',
    multiple: true,
  },
} as const satisfies Record<string, ArgDef>

export const extendsArgs = {
  extends: {
    type: 'string',
    description: 'Extend from a Nuxt layer',
    valueHint: 'layer-name',
    alias: ['e'],
    multiple: true,
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
 * `--cwd` is deliberately not declared here: commands taking a ROOTDIR positional
 * inherit it from the root command (see {@link globalCwdArgs}) rather than listing
 * it twice in their own help.
 */
export const rootDirArgs = {
  rootDir: {
    type: 'positional',
    description: 'The root directory of your Nuxt project (default: .)',
    required: false,
    default: undefined,
  },
} as const satisfies Record<string, ArgDef>

export const jsonArgs = {
  json: {
    type: 'boolean',
    description: 'Print output as JSON',
  },
} as const satisfies Record<string, ArgDef>
