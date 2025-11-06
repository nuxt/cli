import type { NuxtConfig, NuxtModule } from '@nuxt/schema'
import type { PackageJson } from 'pkg-types'

import os from 'node:os'
import process from 'node:process'
import { stripVTControlCharacters } from 'node:util'

import { box } from '@clack/prompts'
import { defineCommand } from 'citty'
import { colors } from 'consola/utils'
import { copy as copyToClipboard } from 'copy-paste'
import { detectPackageManager } from 'nypm'
import { resolve } from 'pathe'
import { readPackageJSON } from 'pkg-types'
import { isBun, isDeno, isMinimal } from 'std-env'

import { version as nuxiVersion } from '../../package.json'

import { getBuilder } from '../utils/banner'
import { tryResolveNuxt } from '../utils/kit'
import { logger } from '../utils/logger'
import { getPackageManagerVersion } from '../utils/packageManagers'
import { cwdArgs, legacyRootDirArgs } from './_shared'

export default defineCommand({
  meta: {
    name: 'info',
    description: 'Get information about Nuxt project',
  },
  args: {
    ...cwdArgs,
    ...legacyRootDirArgs,
  },
  async run(ctx) {
    // Resolve rootDir
    const cwd = resolve(ctx.args.cwd || ctx.args.rootDir)

    // Load Nuxt config
    const nuxtConfig = await getNuxtConfig(cwd)

    // Find nearest package.json
    const { dependencies = {}, devDependencies = {} } = await readPackageJSON(cwd).catch(() => ({} as PackageJson))

    // Utils to query a dependency version
    const nuxtPath = tryResolveNuxt(cwd)
    async function getDepVersion(name: string) {
      for (const url of [cwd, nuxtPath]) {
        if (!url) {
          continue
        }
        const pkg = await readPackageJSON(name, { url }).catch(() => null)
        if (pkg) {
          return pkg.version!
        }
      }
      return dependencies[name] || devDependencies[name]
    }

    async function listModules(arr: NonNullable<NuxtConfig['modules']> = []) {
      const info: string[] = []
      for (let m of arr) {
        if (Array.isArray(m)) {
          m = m[0]
        }
        const name = normalizeConfigModule(m, cwd)
        if (name) {
          const npmName = name!.split('/').splice(0, 2).join('/') // @foo/bar/baz => @foo/bar
          const v = await getDepVersion(npmName)
          info.push(`\`${v ? `${name}@${v}` : name}\``)
        }
      }
      return info.join(', ')
    }

    // Check Nuxt version
    const nuxtVersion = await getDepVersion('nuxt') || await getDepVersion('nuxt-nightly') || await getDepVersion('nuxt-edge') || await getDepVersion('nuxt3') || '-'
    const isLegacy = nuxtVersion.startsWith('2')
    const builder = !isLegacy
      ? nuxtConfig.builder /* latest schema */ || 'vite'
      : (nuxtConfig as any /* nuxt v2 */).bridge?.vite
          ? 'vite' /* bridge vite implementation */
          : (nuxtConfig as any /* nuxt v2 */).buildModules?.includes('nuxt-vite')
              ? 'vite' /* nuxt-vite */
              : 'webpack'

    let packageManager = (await detectPackageManager(cwd))?.name

    if (packageManager) {
      packageManager += `@${getPackageManagerVersion(packageManager)}`
    }

    const osType = os.type()
    const builderInfo = typeof builder === 'string'
      ? getBuilder(cwd, builder)
      : { name: 'custom', version: '0.0.0' }

    const infoObj = {
      'Operating system': osType === 'Darwin' ? `macOS ${os.release()}` : osType === 'Windows_NT' ? `Windows ${os.release()}` : `${osType} ${os.release()}`,
      'CPU': `${os.cpus()[0]?.model || 'unknown'} (${os.cpus().length} cores)`,
      ...isBun
        // @ts-expect-error Bun global
        ? { 'Bun version': Bun?.version as string }
        : isDeno
          // @ts-expect-error Deno global
          ? { 'Deno version': Deno?.version.deno as string }
          : { 'Node.js version': process.version as string },
      'nuxt/cli version': nuxiVersion,
      'Package manager': packageManager ?? 'unknown',
      'Nuxt version': nuxtVersion,
      'Nitro version': await getDepVersion('nitropack') || await getDepVersion('nitro'),
      'Builder': builderInfo.name === 'custom' ? 'custom' : `${builderInfo.name.toLowerCase()}@${builderInfo.version}`,
      'Config': Object.keys(nuxtConfig)
        .map(key => `\`${key}\``)
        .sort()
        .join(', '),
      'Modules': await listModules(nuxtConfig.modules),
      ...isLegacy
        ? { 'Build modules': await listModules((nuxtConfig as any /* nuxt v2 */).buildModules || []) }
        : {},
    }

    logger.info(`Nuxt root directory: ${colors.cyan(nuxtConfig.rootDir || cwd)}\n`)

    let firstColumnLength = 0
    let ansiFirstColumnLength = 0
    const entries = Object.entries(infoObj).map(([label, val]) => {
      if (label.length > firstColumnLength) {
        ansiFirstColumnLength = colors.bold(colors.whiteBright(label)).length + 4
        firstColumnLength = label.length + 4
      }
      return [label, val || '-'] as const
    })

    // get maximum width of terminal
    const terminalWidth = Math.max(process.stdout.columns || 80, firstColumnLength) - 4 /* box padding */

    // formatted for copy-pasting into an issue
    let copyStr = '|     |     |\n| --- | --- |\n'
    let boxStr = ''
    for (const [label, value] of entries) {
      if (!isMinimal) {
        copyStr += `| **${label}** | ${value.includes('`') ? value : `\`${value}\``} |\n`
      }
      const formattedValue = value
        .replace(/\b@([^, ]+)/g, (_, r) => colors.gray(` ${r}`))
        .replace(/`([^`]*)`/g, (_, r) => r)

      boxStr += (`${colors.bold(colors.whiteBright(label))}: `).padEnd(ansiFirstColumnLength)

      let boxRowLength = firstColumnLength
      for (const item of formattedValue.split(', ')) {
        const itemLength = stripVTControlCharacters(item).length + 2
        if (boxRowLength + itemLength > terminalWidth) {
          boxStr += `\n${' '.repeat(firstColumnLength)}`
          boxRowLength = firstColumnLength
        }
        boxStr += `${item}, `
        boxRowLength += itemLength
      }
      boxStr = `${boxStr.slice(0, -2)}\n`
    }

    const copied = !isMinimal && await new Promise(resolve => copyToClipboard(copyStr, err => resolve(!err)))

    box(
      `\n${boxStr}`,
      ` Nuxt project info ${copied ? colors.gray('(copied to clipboard) ') : ''}`,
      {
        contentAlign: 'left',
        titleAlign: 'left',
        width: 'auto',
        titlePadding: 2,
        contentPadding: 2,
        rounded: true,
      },
    )

    const isNuxt3 = !isLegacy
    const isBridge = !isNuxt3 && infoObj['Build modules']?.includes('bridge')
    const repo = isBridge ? 'nuxt/bridge' : 'nuxt/nuxt'
    const docsURL = (isNuxt3 || isBridge) ? 'https://nuxt.com' : 'https://v2.nuxt.com'
    logger.info(`👉 Read documentation: ${colors.cyan(docsURL)}`)
    if (isNuxt3 || isBridge) {
      logger.info(`👉 Report an issue: ${colors.cyan(`https://github.com/${repo}/issues/new?template=bug-report.yml`)}`, {
        spacing: 0,
      })
      logger.info(`👉 Suggest an improvement: ${colors.cyan(`https://github.com/${repo}/discussions/new`)}`, {
        spacing: 0,
      })
    }
  },
})

function normalizeConfigModule(
  module: NuxtModule<any, any> | string | false | null | undefined,
  rootDir: string,
): string | null {
  if (!module) {
    return null
  }
  if (typeof module === 'string') {
    return module
      .split(rootDir)
      .pop()! // Strip rootDir
      .split('node_modules')
      .pop()! // Strip node_modules
      .replace(/^\//, '')
  }
  if (typeof module === 'function') {
    return `${module.name}()`
  }
  if (Array.isArray(module)) {
    return normalizeConfigModule(module[0], rootDir)
  }
  return null
}

async function getNuxtConfig(rootDir: string) {
  try {
    const { createJiti } = await import('jiti')
    const jiti = createJiti(rootDir, {
      interopDefault: true,
      // allow using `~` and `@` in `nuxt.config`
      alias: {
        '~': rootDir,
        '@': rootDir,
      },
    })
    ;(globalThis as any).defineNuxtConfig = (c: any) => c
    const result = await jiti.import('./nuxt.config', { default: true }) as NuxtConfig
    delete (globalThis as any).defineNuxtConfig
    return result
  }
  catch {
    // TODO: Show error as warning if it is not 404
    return {}
  }
}
