import { resolve } from 'node:path'
import { x } from 'tinyexec'

const dirs = ['create-nuxt', 'nuxi', 'nuxt-cli']

for (const dir of dirs) {
  await x('changelogen', ['--canary', 'nightly', '--publish'], {
    nodeOptions: { stdio: 'inherit', cwd: resolve('packages', dir) },
    throwOnError: true,
  })
}
