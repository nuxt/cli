import { execa } from 'execa'
import { resolve } from 'pathe'
import { tryResolveModule } from '../utils/cjs'

import { loadKit } from '../utils/kit'
import { writeTypes } from '../utils/prepare'
import { defineNuxtCommand } from './index'

export default defineNuxtCommand({
  meta: {
    name: 'typecheck',
    description: 'Runs `vue-tsc` to check types throughout your app.',
  },
  args: {
    rootDir: {
      type: 'positional',
      description: 'Root directory of your Nuxt app',
    },
  },
  async run({ args }) {
    process.env.NODE_ENV = process.env.NODE_ENV || 'production'
    const rootDir = resolve(args._[0] || '.')

    const { loadNuxt, buildNuxt } = await loadKit(rootDir)
    const nuxt = await loadNuxt({ rootDir, config: { _prepare: true } })

    // Generate types and build nuxt instance
    await writeTypes(nuxt)
    await buildNuxt(nuxt)
    await nuxt.close()

    // Prefer local install if possible
    const hasLocalInstall =
      tryResolveModule('typescript', rootDir) &&
      tryResolveModule('vue-tsc/package.json', rootDir)
    if (hasLocalInstall) {
      await execa('vue-tsc', ['--noEmit'], {
        preferLocal: true,
        stdio: 'inherit',
        cwd: rootDir,
      })
    } else {
      await execa(
        'npx',
        '-p vue-tsc -p typescript vue-tsc --noEmit'.split(' '),
        { stdio: 'inherit', cwd: rootDir }
      )
    }
  },
})
