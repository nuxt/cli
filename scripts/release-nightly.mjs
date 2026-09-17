import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { x } from 'tinyexec'

const dirs = ['create-nuxt', 'nuxi', 'nuxt-cli']

for (const dir of dirs) {
  const cwd = resolve('packages', dir)
  const pkgPath = resolve(cwd, 'package.json')
  const original = await readFile(pkgPath, 'utf8')

  await addNightlyBins(pkgPath, original)

  let published
  try {
    await x('changelogen', ['--canary', 'nightly', '--publish'], {
      nodeOptions: { stdio: 'inherit', cwd },
      throwOnError: true,
    })
  }
  finally {
    published = JSON.parse(await readFile(pkgPath, 'utf8'))
    await writeFile(pkgPath, original)
  }

  await assertPublished(published.name, published.version)
}

/**
 * `changelogen --publish` logs publish failures without exiting non-zero, so
 * confirm the version is actually on the registry.
 */
async function assertPublished(name, version) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`https://registry.npmjs.org/${name}/${version}`)
    if (res.ok) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 5000))
  }
  throw new Error(`\`${name}@${version}\` was not published to the registry`)
}

/**
 * `npx <pkg>` only resolves a bin whose name matches the (unscoped) package
 * name when a package ships more than one bin, so the `-nightly` packages need
 * `-nightly` aliases for each of their bins.
 */
async function addNightlyBins(pkgPath, original) {
  const pkg = JSON.parse(original)
  if (!pkg.bin) {
    return
  }

  const bin = { ...pkg.bin }
  const entrypoint = Object.values(pkg.bin)[0]
  bin[`${pkg.name.split('/').pop()}-nightly`] = entrypoint
  for (const [name, path] of Object.entries(pkg.bin)) {
    bin[`${name}-nightly`] = path
  }

  await writeFile(pkgPath, `${JSON.stringify({ ...pkg, bin }, null, 2)}\n`)
}
