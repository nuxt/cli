import { defineCommand } from 'citty'
import { resolve } from 'pathe'
import consola from 'consola'
import { addDependency } from 'nypm'
import { $fetch } from 'ofetch'
import { satisfies } from 'semver'
import { updateConfig } from 'c12/update'
import { colors } from 'consola/utils'
import { sharedArgs } from '../_shared'
import {
  checkNuxtCompatibility,
  fetchModules,
  getNuxtVersion,
  getProjectPackage,
} from './_utils'
import type { NuxtModule } from './_utils'

// Maybe we can import the list from somewhere, but idk
const forceDevDependencies = [
  "@nuxt/eslint@latest",
  "@nuxtjs/color-mode"
]

export default defineCommand({
  meta: {
    name: 'add',
    description: 'Add Nuxt modules',
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
    const projectPkg = await getProjectPackage(cwd)

    if (!projectPkg.dependencies?.nuxt && !projectPkg.devDependencies?.nuxt) {
      consola.warn(`No \`nuxt\` dependency detected in \`${cwd}\`.`)
      const shouldContinue = await consola.prompt(
        `Do you want to continue anyway?`,
        {
          type: 'confirm',
          initial: false,
        },
      )
      if (shouldContinue !== true) {
        return false
      }
    }

    const r = await resolveModule(ctx.args.moduleName, cwd)
    if (r === false) {
      return
    }

    // Add npm dependency
    if (!ctx.args.skipInstall) {
      const isDev = Boolean(projectPkg.devDependencies?.nuxt || forceDevDependencies.includes(r.pkg))
      consola.info(
        `Installing \`${r.pkg}\`${isDev ? ' development' : ''} dependency`,
      )
      const res = await addDependency(r.pkg, { cwd, dev: isDev, installPeerDependencies: true }).catch(
        (error) => {
          consola.error(error)
          return consola.prompt(
            `Install failed for ${colors.cyan(
              r.pkg,
            )}. Do you want to continue adding the module to ${colors.cyan(
              'nuxt.config',
            )}?`,
            {
              type: 'confirm',
              initial: false,
            },
          )
        },
      )
      if (res === false) {
        return
      }
    }

    // Update nuxt.config.ts
    if (!ctx.args.skipConfig) {
      await updateConfig({
        cwd,
        configFile: 'nuxt.config',
        async onCreate() {
          consola.info(`Creating \`nuxt.config.ts\``)
          return getDefaultNuxtConfig()
        },
        async onUpdate(config) {
          if (!config.modules) {
            config.modules = []
          }
          if (config.modules.includes(r.pkgName)) {
            consola.info(`\`${r.pkgName}\` is already in the \`modules\``)
            return
          }
          consola.info(`Adding \`${r.pkgName}\` to the \`modules\``)
          config.modules.push(r.pkgName)
        },
      }).catch((error) => {
        consola.error(`Failed to update \`nuxt.config\`: ${error.message}`)
        consola.error(`Please manually add \`${r.pkgName}\` to the \`modules\` in \`nuxt.config.ts\``)
        return null
      })
    }
  },
})

// -- Internal Utils --
function getDefaultNuxtConfig() {
  return `
// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: []
})`
}

// Based on https://github.com/dword-design/package-name-regex
const packageRegex
  = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?([a-z0-9-~][a-z0-9-._~]*)(@[^@]+)?$/

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
  }
  else {
    consola.error(`Invalid package name \`${pkgName}\`.`)
    return false
  }

  const modulesDB = await fetchModules().catch((err) => {
    consola.warn('Cannot search in the Nuxt Modules database: ' + err)
    return []
  })

  const matchedModule = modulesDB.find(
    module =>
      module.name === moduleName
      || module.npm === pkgName
      || module.aliases?.includes(pkgName),
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
        `The module \`${pkgName}\` is not compatible with Nuxt \`${nuxtVersion}\` (requires \`${matchedModule.compatibility.nuxt}\`)`,
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
          }
          else {
            consola.warn(
              `Recommended version of \`${pkgName}\` for Nuxt \`${nuxtVersion}\` is \`${_moduleVersion}\` but you have requested \`${pkgVersion}\``,
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

  // Fetch package on npm
  pkgVersion = pkgVersion || 'latest'
  const pkg = await $fetch(
    `https://registry.npmjs.org/${pkgName}/${pkgVersion}`,
  )
  const pkgDependencies = Object.assign(
    pkg.dependencies || {},
    pkg.devDependencies || {},
  )
  if (
    !pkgDependencies['nuxt']
    && !pkgDependencies['nuxt-edge']
    && !pkgDependencies['@nuxt/kit']
  ) {
    consola.warn(`It seems that \`${pkgName}\` is not a Nuxt module.`)
    const shouldContinue = await consola.prompt(
      `Do you want to continue installing \`${pkgName}\` anyway?`,
      {
        type: 'confirm',
        initial: false,
      },
    )
    if (shouldContinue !== true) {
      return false
    }
  }

  return {
    nuxtModule: matchedModule,
    pkg: `${pkgName}@${pkgVersion}`,
    pkgName,
    pkgVersion,
  }
}
