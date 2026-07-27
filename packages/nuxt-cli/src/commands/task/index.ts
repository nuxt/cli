import { defineCommand } from 'citty'

export default defineCommand({
  meta: {
    name: 'task',
    description: 'List and run Nitro tasks on your dev server',
  },
  args: {},
  subCommands: {
    list: () => import('./list').then(r => r.default || r),
    run: () => import('./run').then(r => r.default || r),
  },
})
