import { box } from '@clack/prompts'
import { defineCommand } from 'citty'
import { colors } from 'consola/utils'
import Fuse from 'fuse.js'
import { kebabCase, upperFirst } from 'scule'

import { formatInfoBox } from '../../utils/formatting'
import { logger } from '../../utils/logger'
import { getNuxtVersion } from '../../utils/versions'
import { cwdArgs } from '../_shared'
import { checkNuxtCompatibility, fetchModules } from './_utils'

const { format: formatNumber } = Intl.NumberFormat('en-GB', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

export default defineCommand({
  meta: {
    name: 'search',
    description: 'Search in Nuxt modules',
  },
  args: {
    ...cwdArgs,
    query: {
      type: 'positional',
      description: 'keywords to search for',
      required: true,
    },
    nuxtVersion: {
      type: 'string',
      description:
        'Filter by Nuxt version and list compatible modules only (auto detected by default)',
      required: false,
      valueHint: '2|3',
    },
  },
  async setup(ctx) {
    const nuxtVersion = await getNuxtVersion(ctx.args.cwd)
    return findModuleByKeywords(ctx.args._.join(' '), nuxtVersion)
  },
})

async function findModuleByKeywords(query: string, nuxtVersion: string) {
  const allModules = await fetchModules()
  const compatibleModules = allModules.filter(m =>
    checkNuxtCompatibility(m, nuxtVersion),
  )
  const fuse = new Fuse(compatibleModules, {
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
      name: result.item.name,
      package: result.item.npm,
      homepage: colors.cyan(result.item.website),
      compatibility: `nuxt: ${result.item.compatibility?.nuxt || '*'}`,
      repository: result.item.github,
      description: result.item.description,
      install: `npx nuxt module add ${result.item.name}`,
      stars: colors.yellow(formatNumber(result.item.stats.stars)),
      monthlyDownloads: colors.yellow(formatNumber(result.item.stats.downloads)),
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
    logger.info(
      `No Nuxt modules found matching query ${colors.magenta(query)} for Nuxt ${colors.cyan(nuxtVersion)}`,
    )
    return
  }

  logger.success(
    `Found ${results.length} Nuxt ${results.length > 1 ? 'modules' : 'module'} matching ${colors.cyan(query)} ${nuxtVersion ? `for Nuxt ${colors.cyan(nuxtVersion)}` : ''}:\n`,
  )
  for (const foundModule of results) {
    const formattedModule: Record<string, string> = {}
    for (const [key, val] of Object.entries(foundModule)) {
      const label = upperFirst(kebabCase(key)).replace(/-/g, ' ')
      formattedModule[label] = val
    }
    const title = formattedModule.Name || formattedModule.Package
    delete formattedModule.Name
    const boxContent = formatInfoBox(formattedModule)
    box(
      `\n${boxContent}`,
      ` ${title} `,
      {
        contentAlign: 'left',
        titleAlign: 'left',
        width: 'auto',
        titlePadding: 2,
        contentPadding: 2,
        rounded: true,
      },
    )
  }
}
