import process from 'node:process'

import { box } from '@clack/prompts'
import { defineCommand } from 'citty'
import { byLengthAsc, Fzf } from 'fzf'
import colors from 'picocolors'
import { kebabCase, upperFirst } from 'scule'

import { formatInfoBox } from '../../utils/formatting'
import { logger } from '../../utils/logger'
import { logNetworkError } from '../../utils/network'
import { DEFAULT_NUXT_VERSION, getNuxtVersion } from '../../utils/versions'
import { cwdArgs } from '../_shared'
import { checkNuxtCompatibility, fetchModules, MODULES_API_URL } from './_utils'

const DASH_RE = /-/g

const { format: formatNumber } = new Intl.NumberFormat('en-GB', {
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
    const nuxtVersion = await getNuxtVersion(ctx.args.cwd).catch(() => DEFAULT_NUXT_VERSION)
    return findModuleByKeywords(ctx.args._.join(' '), nuxtVersion)
  },
})

async function findModuleByKeywords(query: string, nuxtVersion: string) {
  const allModules = await fetchModules().catch((err) => {
    logNetworkError(err, { url: MODULES_API_URL })
    process.exit(1)
  })
  const compatibleModules = allModules.filter(m =>
    checkNuxtCompatibility(m, nuxtVersion),
  )
  const fzf = new Fzf(compatibleModules, {
    selector: m => [
      m.name,
      m.npm,
      m.repo,
      m.tags?.join(' '),
      m.category,
      m.description,
      m.maintainers.map(maintainer => `${maintainer.name} ${maintainer.github}`).join(' '),
    ].filter(Boolean).join(' '),
    casing: 'case-insensitive',
    tiebreakers: [byLengthAsc],
  })

  const results = fzf.find(query).map(({ item }) => {
    const res: Record<string, string> = {
      name: item.name,
      package: item.npm,
      homepage: colors.cyan(item.website),
      compatibility: `nuxt: ${item.compatibility?.nuxt || '*'}`,
      repository: item.github,
      description: item.description,
      install: `npx nuxt add ${item.name}`,
      stars: colors.yellow(formatNumber(item.stats.stars)),
      monthlyDownloads: colors.yellow(formatNumber(item.stats.downloads)),
    }
    if (item.github === item.website) {
      delete res.homepage
    }
    if (item.name === item.npm) {
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
      const label = upperFirst(kebabCase(key)).replace(DASH_RE, ' ')
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
