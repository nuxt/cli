import { resolve } from 'pathe'
import { defineNuxtCommand } from './index'
import { existsSync } from 'node:fs'
import { loadFile, writeFile, parseCode } from 'magicast'
import type { ModuleNode } from 'magicast'
import consola from 'consola'
import type { Argv } from 'mri'
import { addDependency } from 'nypm'
import { fetchModules } from '../utils/modules'
import Fuse from 'fuse.js'
import { splitByCase } from 'scule'
import { bold, green, red } from 'colorette'

export default defineNuxtCommand({
  meta: {
    name: 'module',
    usage: 'nuxi module add <name>',
    description: 'Manage Nuxt Modules',
  },
  async invoke(args) {
    const command = args._.shift()
    if (command === 'add') {
      return addModule(args)
    } else if (command === 'search') {
      return findModuleByKeywords(args._)
    }
    throw new Error(`Unknown sub-command: module ${command}`)
  },
})

// --- Sub Commands ---

async function addModule(args: Argv) {
  const rootDir = resolve(args.rootDir || args.dir || '.')
  const [moduleName] = args._

  // TODO: Resolve and validate npm package name first
  const npmPackage = moduleName

  // Add npm dependency
  if (!args.skipInstall) {
    consola.info(`Installing dev dependency \`${npmPackage}\``)
    await addDependency(npmPackage, { cwd: rootDir, dev: true }).catch(
      (err) => {
        consola.error(err)
        consola.error(
          `Please manually install \`${npmPackage}\` as a dev dependency`
        )
      }
    )
  }

  // Update nuxt.config.ts
  if (!args.skipConfig) {
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
    }).catch((err) => {
      consola.error(err)
      consola.error(
        `Please manually add \`${npmPackage}\` to the \`modules\` in \`nuxt.config.ts\``
      )
    })
  }
}

async function findModuleByKeywords(keywords: string[]) {
  const modules = await fetchModules()
  const fuse = new Fuse(modules, {
    keys: [
      { name: 'name', weight: 1 },
      { name: 'npm', weight: 1 },
      { name: 'repo', weight: 1 },
      { name: 'tags', weight: 1 },
      { name: 'category', weight: 1 },
      { name: 'description', weight: 0.5 },
      { name: 'maintainers.name', weight: 0.5 },
      { name: 'maintainers.github', weight: 0.5 },
    ],
    threshold: 0.1,
  })
  const fuseResults = fuse.search(keywords.join(' '))
  const foundModules = fuseResults.map((result) => {
    return {
      Name: result.item.name,
      PackageName: result.item.npm,
      Description: result.item.description,
      Type: result.item.type,
      Maintainers: result.item.maintainers
        .map((maintainer) => maintainer.name)
        .join(', '),
      Homepage: result.item.website,
      Repository: result.item.github,
    }
  })

  if (fuseResults.length > 0) {
    consola.success(
      `Found ${fuseResults.length} ${
        fuseResults.length > 1 ? 'modules' : 'module'
      }:`
    )
    for (const foundModule of foundModules) {
      let maxLength = 0
      const entries = Object.entries(foundModule).map(([key, val]) => {
        const label = splitByCase(key).join(' ')
        if (label.length > maxLength) {
          maxLength = label.length
        }
        return [label, val || '-']
      })
      let infoStr = ''
      for (const [label, value] of entries) {
        infoStr +=
          bold('- ') +
          (green(label) + ': ').padEnd(maxLength + 2) +
          (value.includes('`') ? value : '`' + value + '`') +
          '\n'
      }
      const splitter = '------------------------------'
      console.log(`\n${splitter}\n${infoStr}${splitter}\n`)
    }
  } else {
    consola.info(`No modules found with keywords: ${red(keywords.join(' '))}`)
  }
}

// -- Internal Utils --

async function updateNuxtConfig(
  rootDir: string,
  update: (config: any) => void
) {
  let _module: ModuleNode
  const nuxtConfigFile = resolve(rootDir, 'nuxt.config.ts')
  if (existsSync(nuxtConfigFile)) {
    consola.info('Updating `nuxt.config.ts`')
    _module = await loadFile(nuxtConfigFile)
  } else {
    consola.info('Creating `nuxt.config.ts`')
    _module = parseCode(getDefaultNuxtConfig())
  }
  const defaultExport = _module.exports.default
  if (!defaultExport) {
    throw new Error('`nuxt.config.ts` does not have a default export!')
  }
  if (defaultExport.$type === 'function-call') {
    update(defaultExport.arguments[0])
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
