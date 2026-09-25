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

/**
 * The deploy target within the configured server builder.
 *
 * `--preset` names the same thing for Nitro, the only builder with a target axis
 * today, and keeps working for the many deployment guides that use it. It is a
 * hidden option rather than an alias because citty renders a multi-character
 * alias as `-preset` in help output.
 */
export const targetArgs = {
  target: {
    type: 'string',
    description: 'Deploy target for the configured server builder (e.g. `node-server`, `vercel`, `netlify`)',
    valueHint: 'target',
  },
  preset: {
    type: 'string',
    description: 'Alias for `--target`',
    valueHint: 'target',
    hidden: true,
  },
} as const satisfies Record<string, ArgDef>

export const profileArgs = {
  profile: {
    type: 'string',
    description: 'Profile performance, writing a V8 CPU profile and a JSON report on exit. Use `--profile=verbose` for a full console report.',
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
