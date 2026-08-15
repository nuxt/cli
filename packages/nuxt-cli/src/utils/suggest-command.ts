import { commandPolicy, suggestClosest } from './suggest'

/** Best guess at the command a user meant to type. */
export function suggestCommand(input: string, commands: string[]): Promise<string | undefined> {
  return suggestClosest(input, commands, commandPolicy)
}
