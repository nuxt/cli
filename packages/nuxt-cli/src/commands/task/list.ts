import type { TaskList } from './_utils'

import process from 'node:process'
import { styleText } from 'node:util'

import { defineCommand } from 'citty'

import { logger } from '../../utils/logger'
import { resolveRootDir } from '../../utils/paths'
import { rootDirArgs } from '../_shared'
import { emptyTaskListHint, fetchTasks, missingTaskRoutesHint, reportTaskError, resolveTaskServer, taskArgs } from './_utils'

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
    const cwd = resolveRootDir(ctx.args)
    const server = await resolveTaskServer(ctx.args)
    const response = await fetchTasks(server)

    if (!response.ok) {
      reportTaskError(response)
      if (response.status === 404) {
        logger.info(missingTaskRoutesHint())
      }
      process.exit(1)
    }

    const { tasks = {}, scheduledTasks } = (response.data || {}) as TaskList
    const names = Object.keys(tasks).sort()

    if (names.length === 0) {
      logger.info(`No tasks found. ${await emptyTaskListHint(cwd)}`)
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
