import { resolve } from 'node:path'
import process from 'node:process'
import { x } from 'tinyexec'

const isNightly = process.env.RELEASE_TYPE === 'nightly'

const dirs = ['create-nuxt-app', 'nuxi', 'nuxt-cli']

for (const dir of dirs) {
  if (isNightly) {
    await x('changelogen', ['--canary', 'nightly', '--publish'], {
      nodeOptions: { stdio: 'inherit', cwd: resolve('packages', dir) },
      throwOnError: true,
    })
  }
  else {
    await x('npm', ['publish'], {
      nodeOptions: { stdio: 'inherit', cwd: resolve('packages', dir) },
      throwOnError: true,
    })
  }
}
