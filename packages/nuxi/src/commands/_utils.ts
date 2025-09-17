import { type commands } from '.';

// Inlined list of nuxi commands to avoid including `commands` in bundle if possible
export const nuxiCommands = [
  'add',
  'analyze',
  'build',
  'cleanup',
  '_dev',
  'dev',
  'devtools',
  'generate',
  'info',
  'init',
  'module',
  'prepare',
  'preview',
  'start',
  'test',
  'typecheck',
  'upgrade',
] as const satisfies (keyof typeof commands)[];

export function isNuxiCommand(command: string) {
  return (nuxiCommands as string[]).includes(command);
}
