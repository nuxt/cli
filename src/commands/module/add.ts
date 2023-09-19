import { resolve } from 'pathe'
import { defineCommand } from 'citty'
import { sharedArgs } from '../_shared'
import { existsSync } from 'node:fs'
import { loadFile, writeFile, parseModule, ProxifiedModule } from 'magicast'
import consola from 'consola'
import { addDependency } from 'nypm'
import {
  NuxtModule,
  checkNuxtCompatibility,
  fetchModules,
  getNuxtVersion,
} from './_utils'
import { satisfies } from 'semver'

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

    const r = await resolveModule(ctx.args.moduleName, cwd)
    if (r === false) {
      return
    }

    // Add npm dependency
    if (!ctx.args.skipInstall) {
      consola.info(`Installing dev dependency \`${r.npm}\``)
      await addDependency(r.npm, { cwd, dev: true }).catch((err) => {
        consola.error(err)
        consola.error(
          `Please manually install \`${r.npm}\` as a dev dependency`,
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
          if (config.modules[i] === r.npm) {
            consola.info(`\`${r.npm}\` is already in the \`modules\``)
            return
          }
        }
        consola.info(`Adding \`${r.npm}\` to the \`modules\``)
        config.modules.push(r.npm)
      }).catch((err) => {
        consola.error(err)
        consola.error(
          `Please manually add \`${r.npm}\` to the \`modules\` in \`nuxt.config.ts\``,
        )
      })
    }
  },
})

// -- Internal Utils --

async function updateNuxtConfig(
  rootDir: string,
  update: (config: any) => void,
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

async function resolveModule(
  moduleName: string,
  cwd: string,
): Promise<false | { module?: NuxtModule; npm: string }> {
  let npmName = moduleName

  const modulesDB = await fetchModules().catch((err) => {
    consola.warn('Cannot search in the Nuxt Modules database: ' + err)
    return []
  })
  const matchedModule = modulesDB.find(
    (module) => module.name === moduleName || module.npm === moduleName,
  )
  if (matchedModule?.npm) {
    npmName = matchedModule.npm
  }

  if (matchedModule && matchedModule.compatibility.nuxt) {
    // Get local Nuxt version
    const nuxtVersion = await getNuxtVersion(cwd)

    // Check for Module Compatibility
    if (!checkNuxtCompatibility(matchedModule, nuxtVersion)) {
      consola.warn(
        `The module \`${npmName}\` is not compatible with Nuxt ${nuxtVersion} (requires ${matchedModule.compatibility.nuxt})`,
      )
      const shouldContinue = await consola.prompt(
        'Do you want to continue installing incompatible version?',
        {
          type: 'confirm',
          initial: false,
        },
      )
      if (shouldContinue !== true) {
        return false
      }
    }

    // TODO: Preview for https://github.com/nuxt/modules/pull/770
    if (
      matchedModule.name === 'image' &&
      !matchedModule.compatibility.versionMap
    ) {
      matchedModule.compatibility.versionMap = {
        '^2.x': '^0',
        '^3.x': 'rc',
      }
      // Match corresponding version of module for local Nuxt version
      const versionMap = matchedModule.compatibility.versionMap
      if (versionMap) {
        for (const _nuxtVersion in versionMap) {
          if (satisfies(nuxtVersion, _nuxtVersion)) {
            npmName = `${npmName}@${versionMap[_nuxtVersion]}`
            break
          }
        }
      }
    }
  }

  return {
    module: matchedModule,
    npm: npmName,
  }
}
