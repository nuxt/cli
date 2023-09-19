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
      consola.info(`Installing dev dependency \`${r.pkg}\``)
      await addDependency(r.pkg, { cwd, dev: true }).catch((err) => {
        consola.error(err)
        consola.error(
          `Please manually install \`${r.pkg}\` as a dev dependency`,
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
          if (config.modules[i] === r.pkgName) {
            consola.info(`\`${r.pkgName}\` is already in the \`modules\``)
            return
          }
        }
        consola.info(`Adding \`${r.pkgName}\` to the \`modules\``)
        config.modules.push(r.pkgName)
      }).catch((err) => {
        consola.error(err)
        consola.error(
          `Please manually add \`${r.pkgName}\` to the \`modules\` in \`nuxt.config.ts\``,
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

// Based on https://github.com/dword-design/package-name-regex
const packageRegex =
  /^(@[a-z0-9-~][a-z0-9-._~]*\/)?([a-z0-9-~][a-z0-9-._~]*)(@[^@]+)?$/

async function resolveModule(
  moduleName: string,
  cwd: string,
): Promise<
  | false
  | {
      nuxtModule?: NuxtModule
      pkg: string
      pkgName: string
      pkgVersion: string
    }
> {
  let pkgName = moduleName
  let pkgVersion: string | undefined

  const reMatch = moduleName.match(packageRegex)
  if (reMatch) {
    if (reMatch[3]) {
      pkgName = `${reMatch[1] || ''}${reMatch[2] || ''}`
      pkgVersion = reMatch[3].slice(1)
    }
  } else {
    consola.error(`Invalid package name \`${pkgName}\`.`)
    return false
  }

  const modulesDB = await fetchModules().catch((err) => {
    consola.warn('Cannot search in the Nuxt Modules database: ' + err)
    return []
  })

  const matchedModule = modulesDB.find(
    (module) => module.name === moduleName || module.npm === pkgName,
  )

  if (matchedModule?.npm) {
    pkgName = matchedModule.npm
  }

  if (matchedModule && matchedModule.compatibility.nuxt) {
    // Get local Nuxt version
    const nuxtVersion = await getNuxtVersion(cwd)

    // Check for Module Compatibility
    if (!checkNuxtCompatibility(matchedModule, nuxtVersion)) {
      consola.warn(
        `The module \`${pkgName}\` is not compatible with Nuxt ${nuxtVersion} (requires ${matchedModule.compatibility.nuxt})`,
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

    // Match corresponding version of module for local Nuxt version
    const versionMap = matchedModule.compatibility.versionMap
    if (versionMap) {
      for (const [_nuxtVersion, _moduleVersion] of Object.entries(versionMap)) {
        if (satisfies(nuxtVersion, _nuxtVersion)) {
          if (!pkgVersion) {
            pkgVersion = _moduleVersion
          } else {
            consola.warn(
              `Recommanded version of \`${pkgName}\` for Nuxt \`${nuxtVersion}\` is \`${_moduleVersion}\` but you have requested \`${pkgVersion}\``,
            )
            pkgVersion = await consola.prompt('Choose a version:', {
              type: 'select',
              options: [_moduleVersion, pkgVersion],
            })
          }
          break
        }
      }
    }
  }

  return {
    nuxtModule: matchedModule,
    pkg: `${pkgName}@${pkgVersion || 'latest'}`,
    pkgName,
    pkgVersion: pkgVersion || 'latest',
  }
}
