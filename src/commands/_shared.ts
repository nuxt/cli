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

export const legacyRootDirArgs = {
  rootDir: {
    type: 'positional',
    description: 'Root Directory',
    required: false,
  },
} as const
