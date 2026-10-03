import { defineCommand } from 'citty'
import { commandMeta } from '../meta'

export default defineCommand({
  meta: commandMeta.module,
  args: {},
  subCommands: {
    add: () => import('./add').then(r => r.default || r),
    remove: () => import('./remove').then(r => r.default || r),
    search: () => import('./search').then(r => r.default || r),
  },
})
