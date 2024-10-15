export const sharedArgs = {
  cwd: {
    type: 'string',
    description: 'Current working directory',
  },
  logLevel: {
    type: 'string',
    description: 'Log level',
  },
} as const

export const envNameArgs = {
  envName: {
    type: 'string',
    description: 'The environment to use when resolving configuration overrides (default is `production` when building, and `development` when running the dev server)',
  },
} as const

export const legacyRootDirArgs = {
  rootDir: {
    type: 'positional',
    description: 'Root Directory',
    required: false,
  },
} as const
