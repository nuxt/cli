import { resolve } from 'pathe'
import { defineCommand } from 'citty'
import { sharedArgs } from '../_shared'
import { existsSync } from 'node:fs'
import { loadFile, writeFile, parseModule, ProxifiedModule } from 'magicast'
import consola from 'consola'
import { addDependency } from 'nypm'

export default defineCommand({
  meta: {
    name: 'module',
    description: 'Manage Nuxt Modules',
  },
  args: {
    ...sharedArgs,
    moduleName: {
      type: 'positional',
      description: 'Module name',
    },
    skipInstall: {
      type: 'boolean',
      description: 'Skip npm install',
    },
    skipConfig: {
      type: 'boolean',
      description: 'Skip nuxt.config.ts update',
    },
  },
  async setup(ctx) {
    const cwd = resolve(ctx.args.cwd || '.')

    // TODO: Resolve and validate npm package name first
    const npmPackage = ctx.args.moduleName

    // Add npm dependency
    if (!ctx.args.skipInstall) {
      consola.info(`Installing dev dependency \`${npmPackage}\``)
      await addDependency(npmPackage, { cwd, dev: true }).catch((err) => {
        consola.error(err)
        consola.error(
          `Please manually install \`${npmPackage}\` as a dev dependency`
        )
      })
    }

    // Update nuxt.config.ts
    if (!ctx.args.skipConfig) {
      await updateNuxtConfig(cwd, (config) => {
        if (!config.modules) {
          config.modules = []
        }
        for (let i = 0; i < config.modules.length; i++) {
          if (config.modules[i] === npmPackage) {
            consola.info(`\`${npmPackage}\` is already in the \`modules\``)
            return
          }
        }
        consola.info(`Adding \`${npmPackage}\` to the \`modules\``)
        config.modules.push(npmPackage)
      }).catch((err) => {
        consola.error(err)
        consola.error(
          `Please manually add \`${npmPackage}\` to the \`modules\` in \`nuxt.config.ts\``
        )
      })
    }
  },
})

// -- Internal Utils --

async function updateNuxtConfig(
  rootDir: string,
  update: (config: any) => void
) {
  let _module: ProxifiedModule
  const nuxtConfigFile = resolve(rootDir, 'nuxt.config.ts')
  if (existsSync(nuxtConfigFile)) {
    consola.info('Updating `nuxt.config.ts`')
    _module = await loadFile(nuxtConfigFile)
  } else {
    consola.info('Creating `nuxt.config.ts`')
    _module = parseModule(getDefaultNuxtConfig())
  }
  const defaultExport = _module.exports.default
  if (!defaultExport) {
    throw new Error('`nuxt.config.ts` does not have a default export!')
  }
  if (defaultExport.$type === 'function-call') {
    update(defaultExport.$args[0])
  } else {
    update(defaultExport)
  }
  await writeFile(_module as any, nuxtConfigFile)
  consola.success('`nuxt.config.ts` updated')
}

function getDefaultNuxtConfig() {
  return `
// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: []
})`
}
