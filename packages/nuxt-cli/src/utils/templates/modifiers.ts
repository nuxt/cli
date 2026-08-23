/** Suffixes accepted by `--mode`, and as shorthand flags of their own. */
export const modes = ['client', 'server'] as const

/**
 * Suffixes accepted by `--method`, and as shorthand flags of their own.
 *
 * Order decides the order suffixes are concatenated in when more than one
 * shorthand is passed, so it is kept rather than sorted.
 */
export const httpMethods = ['connect', 'delete', 'get', 'head', 'options', 'post', 'put', 'trace', 'patch'] as const
