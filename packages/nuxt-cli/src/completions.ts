import type { ArgsDef, CommandDef } from 'citty'
import tab from '@bomb.sh/tab/citty'
import { nitroPresets } from './data/nitro-presets'

export async function initCompletions<T extends ArgsDef = ArgsDef>(command: CommandDef<T>) {
  const completion = await tab(command)

  const devCommand = completion.commands.get('dev')
  if (devCommand) {
    const portOption = devCommand.options.get('port')
    if (portOption) {
      portOption.handler = (complete) => {
        complete('3000', 'Default development port')
        complete('3001', 'Alternative port')
        complete('8080', 'Common alternative port')
      }
    }

    const hostOption = devCommand.options.get('host')
    if (hostOption) {
      hostOption.handler = (complete) => {
        complete('localhost', 'Local development')
        complete('0.0.0.0', 'Listen on all interfaces')
        complete('127.0.0.1', 'Loopback address')
      }
    }
  }

  for (const command of ['build', 'generate']) {
    for (const name of ['target', 'preset']) {
      const option = completion.commands.get(command)?.options.get(name)
      if (option) {
        option.handler = (complete) => {
          for (const preset of nitroPresets) {
            complete(preset, '')
          }
        }
      }
    }
  }

  for (const name of ['add', 'module add', 'module remove', 'module search']) {
    const cwdOption = completion.commands.get(name)?.options.get('cwd')
    if (cwdOption) {
      cwdOption.handler = complete => complete('.', 'Current directory')
    }
  }

  const logLevelCommands = ['dev', 'build', 'generate', 'preview', 'prepare']
  for (const cmdName of logLevelCommands) {
    const cmd = completion.commands.get(cmdName)
    if (cmd) {
      const logLevelOption = cmd.options.get('logLevel')
      if (logLevelOption) {
        logLevelOption.handler = (complete) => {
          complete('silent', 'No logs')
          complete('info', 'Standard logging')
          complete('verbose', 'Detailed logging')
        }
      }
    }
  }

  return completion
}
