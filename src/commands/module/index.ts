import { defineCommand } from 'citty'

export default defineCommand({
  meta: {
    name: 'module',
    description: 'Manage Nuxt Modules',
  },
  args: {},
  subCommands: {
    add: () => import('./add').then((r) => r.default || r),
    search: () => import('./search').then((r) => r.default || r),
  },
})
