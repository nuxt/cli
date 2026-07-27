import process from 'node:process'
import { styleText } from 'node:util'

import { defineCommand } from 'citty'

import { logger } from '../../utils/logger'
import { rootDirArgs } from '../_shared'
import { fetchTasks, reportTaskError, resolveTaskServer, taskArgs } from './_utils'

interface TaskList {
  tasks?: Record<string, { description?: string }>
  scheduledTasks?: { cron: string, tasks: string[] }[] | false
}

export default defineCommand({
  meta: {
    name: 'list',
    description: 'List the tasks a Nuxt server exposes',
  },
  args: {
    ...rootDirArgs,
    ...taskArgs,
  },
  async run(ctx) {
    const server = await resolveTaskServer(ctx.args)
    const response = await fetchTasks(server)

    if (!response.ok) {
      reportTaskError(response)
      process.exit(1)
    }

    const { tasks = {}, scheduledTasks } = (response.data || {}) as TaskList
    const names = Object.keys(tasks).sort()

    if (names.length === 0) {
      logger.info(`No tasks found. Add one in ${styleText('cyan', 'server/tasks/')} and enable ${styleText('cyan', 'nitro.experimental.tasks')}.`)
      return
    }

    const width = Math.max(...names.map(name => name.length))
    const lines = names.map(name => `  ${styleText('cyan', name.padEnd(width))}  ${styleText('dim', tasks[name]?.description || '')}`.trimEnd())

    if (scheduledTasks && scheduledTasks.length > 0) {
      lines.push('', `  ${styleText('bold', 'Scheduled')}`)
      for (const { cron, tasks: scheduled } of scheduledTasks) {
        lines.push(`  ${styleText('cyan', cron)}  ${styleText('dim', scheduled.join(', '))}`)
      }
    }

    process.stdout.write(`${lines.join('\n')}\n`)
  },
})
