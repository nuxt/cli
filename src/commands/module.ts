import { resolve } from 'pathe'
import { defineNuxtCommand } from './index'
import { existsSync } from 'node:fs'
import { loadFile, writeFile, parseCode } from 'magicast'
import type { ModuleNode } from 'magicast'
import consola from 'consola'
import type { Argv } from 'mri'
import { addDependency } from 'nypm'

export default defineNuxtCommand({
  meta: {
    name: 'module',
    usage: 'nuxi module add <name>',
    description: 'Manage Nuxt Modules'
  },
  async invoke(args) {
    const command = args._.shift()
    if (command === 'add') {
      return addModule(args)
    }
    throw new Error(`Unknown sub-command: module ${command}`)
  }
})

// --- Sub Commands ---

async function addModule(args: Argv) {
  const rootDir = resolve(args.rootDir || args.dir || '.')
  const [moduleName] = args._

  // TODO: Resolve and validate npm package name first
  const npmPackage = moduleName

  // Add npm dependency
  consola.info(`Installing dev dependency \`${npmPackage}\``)
  await addDependency(npmPackage, { cwd: rootDir, dev: true })

  // Update nuxt.config.ts
  await updateNuxtConfig(rootDir, (config) => {
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
  }).catch(err => {
    consola.error(err)
    consola.error(`Please manually add \`${npmPackage}\` to the \`modules\` in \`nuxt.config.ts\``)
  })
}


// -- Internal Utils --

async function updateNuxtConfig(rootDir: string, update: (config: any) => void) {
  let _module: ModuleNode
  const nuxtConfigFile = resolve(rootDir, 'nuxt.config.ts')
  if (existsSync(nuxtConfigFile)) {
    consola.info('Updating `nuxt.config.ts`')
    _module = await loadFile(nuxtConfigFile)
  } else {
    consola.info('Creating `nuxt.config.ts`')
    _module = parseCode(getDefaultNuxtConfig())
  }
  update(_module.exports.default.arguments[0])
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
