import type { ArgsDef, CommandDef } from 'citty'
import tab from '@bomb.sh/tab/citty'
import { templates } from './completions-data'

export async function setupInitCompletions<T extends ArgsDef = ArgsDef>(command: CommandDef<T>) {
    const completion = await tab(command)

    const templateOption = completion.options?.get('template')
    if (templateOption) {
        templateOption.handler = (complete) => {
            for (const template of templates) {
                complete(template, '')
            }
        }
    }

    const logLevelOption = completion.options?.get('logLevel')
    if (logLevelOption) {
        logLevelOption.handler = (complete) => {
            complete('silent', 'No logs')
            complete('info', 'Standard logging')
            complete('verbose', 'Detailed logging')
        }
    }

    return completion
}

