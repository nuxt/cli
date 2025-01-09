import { readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { x } from 'tinyexec'

const pkg = await readFile('package.json', 'utf-8').then(r => JSON.parse(r))
const releaseType = process.env.RELEASE_TYPE

const distributions = {
  'nuxi': { ...pkg, dependencies: {}, devDependencies: { ...pkg.dependencies, ...pkg.devDependencies }, name: 'nuxi' },
  '@nuxt/cli': { ...pkg, name: '@nuxt/cli' },
}

for (const [DISTRIBUTION, pkg] of Object.entries(distributions)) {
  await writeFile('package.json', JSON.stringify(pkg, null, 2))
  if (releaseType === 'nightly') {
    await x('changelogen', ['--canary', 'nightly', '--publish'], {
      nodeOptions: { stdio: 'inherit', env: { DISTRIBUTION } },
      throwOnError: true,
    })
  }
  else {
    await x('npm', ['publish', '--no-git-checks'], {
      nodeOptions: { stdio: 'inherit', env: { DISTRIBUTION } },
      throwOnError: true,
    })
  }
}

// clean up
x('git', ['restore', 'package.json'])
