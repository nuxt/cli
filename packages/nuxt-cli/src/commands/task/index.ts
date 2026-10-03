import { defineCommand } from 'citty'
import { commandMeta } from '../meta'

export default defineCommand({
  meta: commandMeta.task,
  args: {},
  subCommands: {
    list: () => import('./list').then(r => r.default || r),
    run: () => import('./run').then(r => r.default || r),
  },
})
