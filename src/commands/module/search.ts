import { defineCommand } from 'citty'
import { sharedArgs } from '../_shared'
import consola from 'consola'
import { fetchModules } from './_utils'
import Fuse from 'fuse.js'
import { upperFirst, kebabCase } from 'scule'
import { bold, green, magenta, cyan, gray } from 'colorette'

export default defineCommand({
  meta: {
    name: 'add',
    description: 'Serch in nuxt modules',
  },
  args: {
    ...sharedArgs,
    query: {
      type: 'positional',
      description: 'keywords to search for',
      required: true,
    },
  },
  async setup(ctx) {
    return findModuleByKeywords(ctx.args._.join(' '))
  },
})

async function findModuleByKeywords(query: string) {
  const modules = await fetchModules()
  const fuse = new Fuse(modules, {
    threshold: 0.1,
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
  })

  const results = fuse.search(query).map((result) => {
    const res: Record<string, string> = {
      name: bold(result.item.name),
      homepage: cyan(result.item.website),
      repository: gray(result.item.github),
      description: gray(result.item.description),
      package: gray(result.item.npm),
      install: cyan(`nuxt module add ${result.item.npm}`),
    }
    if (result.item.github === result.item.website) {
      delete res.homepage
    }
    if (result.item.name === result.item.npm) {
      delete res.packageName
    }
    return res
  })

  if (!results.length) {
    consola.info(`No nuxt modules found matching query ${magenta(query)}`)
    return
  }

  consola.success(
    `Found ${results.length} nuxt ${
      results.length > 1 ? 'modules' : 'module'
    } matching ${cyan(query)}:\n`
  )
  for (const foundModule of results) {
    let maxLength = 0
    const entries = Object.entries(foundModule).map(([key, val]) => {
      const label = upperFirst(kebabCase(key)).replace(/-/g, ' ')
      if (label.length > maxLength) {
        maxLength = label.length
      }
      return [label, val || '-']
    })
    let infoStr = ''
    for (const [label, value] of entries) {
      infoStr +=
        bold(label === 'Install' ? '→ ' : '- ') +
        green(label.padEnd(maxLength + 2)) +
        value +
        '\n'
    }
    console.log(infoStr)
  }
}
