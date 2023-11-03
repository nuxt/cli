import { runCommand } from './src/index'

export async function run() {
  await runCommand('dev', ['playground'])
  return true
}

run()
