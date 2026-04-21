/**
 * List of available template names for `nuxi add-template`.
 *
 * This is a separate module so that `main.ts` can import just the names
 * without pulling in all 16 template implementation modules.
 */
export const templateNames = [
  'api',
  'app',
  'app-config',
  'component',
  'composable',
  'error',
  'layer',
  'layout',
  'middleware',
  'module',
  'page',
  'plugin',
  'server-middleware',
  'server-plugin',
  'server-route',
  'server-util',
] as const

export type TemplateName = typeof templateNames[number]
