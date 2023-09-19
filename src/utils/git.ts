import { exec } from 'child_process'
import { consola } from 'consola'

export function getIsGitInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    exec('git --version', (error, stdout, stderr) => {
      if (error) {
        consola.error('Git is not installed.')
        resolve(false)
        return
      }

      if (stderr) {
        consola.error(`Git check failed. Additional info: ${stderr}`)
        resolve(false)
        return
      }

      consola.info(`Git is installed: ${stdout}`)
      resolve(true)
    })
  })
}

export function initializeGit(cwd: string, dirName: string) {
  exec(`cd ${cwd}/${dirName} && git init`, (error, stdout, stderr) => {
    if (error) {
      consola.error(`exec error: ${error}`)
      return
    }
    consola.log(`Output: ${stdout}`)
    if (stderr) {
      consola.error(`stderr: ${stderr}`)
    }
  })
}
