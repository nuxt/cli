import { runCommand as _runCommand } from 'citty'
import { commands } from './commands'

// Backward compatibility
export async function runCommand(
  commandName: string,
  argv = process.argv.slice(2)
) {
  const subCommand = (commands as any)[commandName]
  if (!subCommand) {
    throw new Error(`Unknown command: ${commandName}`)
  }
  await _runCommand(subCommand, {
    rawArgs: argv,
  })
}
