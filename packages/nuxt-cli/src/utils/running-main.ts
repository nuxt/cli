/** Whether the CLI is running from its `runMain` entry point rather than a programmatic `runCommand`. */
let runningMain = false

export function setRunningMain(value: boolean): void {
  runningMain = value
}

export function isRunningMain(): boolean {
  return runningMain
}
