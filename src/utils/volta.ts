import { execa } from 'execa'
import { clean, valid } from 'semver'

export const getVoltaCommand = (command: string, args: string[] = []) => {
  return ['volta', ...command.split(' '), ...args].filter(Boolean)
}

export const runVoltaCommand = (command: string, args: string[] = []) => {
  return execa(getVoltaCommand(command, args).join(' '))
}

export const hasVolta = async () => {
  try {
    const { stdout, stderr } = await runVoltaCommand('', ['--version'])
    if (stderr) {
      return false
    }
    return !!valid(stdout)
  } catch {
    return false
  }
}

export const getVoltaNodeVersion = async () => {
  const { stdout } = await runVoltaCommand('which node')
  if (!stdout) {
    return
  }
  const { stdout: version } = await execa(stdout, ['--version'])
  if (!valid(version)) {
    return
  }
  return clean(version)
}

export const voltaRun = async (command: string) => {
  const args = process.argv.slice(2)
  if (args.length) {
    command = `${command} ${args.join(' ')}`
  }
  try {
    if (await hasVolta()) {
      const v = await getVoltaNodeVersion()
      if (v) {
        command = `volta run --node ${v} ${command}`
      }
    }
  } finally {
    execa(command, { stdio: 'inherit' })
  }
}
