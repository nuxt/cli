import type { NuxtConfig, NuxtModule } from '@nuxt/schema'
import type { PackageJson } from 'pkg-types'

import os from 'node:os'
import process from 'node:process'

import { defineCommand } from 'citty'
import clipboardy from 'clipboardy'
import { createJiti } from 'jiti'
import { detectPackageManager } from 'nypm'
import { resolve } from 'pathe'
import { readPackageJSON } from 'pkg-types'
import { splitByCase } from 'scule'

import nuxiPkg from '../../package.json' assert { type: 'json' }

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
    const nuxtPath = await tryResolveNuxt(cwd)
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
      ? nuxtConfig.builder /* latest schema */ || '-'
      : (nuxtConfig as any /* nuxt v2 */).bridge?.vite
          ? 'vite' /* bridge vite implementation */
          : (nuxtConfig as any /* nuxt v2 */).buildModules?.includes('nuxt-vite')
              ? 'vite' /* nuxt-vite */
              : 'webpack'

    let packageManager = (await detectPackageManager(cwd))?.name

    if (packageManager) {
      packageManager += `@${getPackageManagerVersion(packageManager)}`
    }

    const infoObj = {
      OperatingSystem: os.type(),
      NodeVersion: process.version,
      NuxtVersion: nuxtVersion,
      CLIVersion: nuxiPkg.version,
      NitroVersion: await getDepVersion('nitropack'),
      PackageManager: packageManager ?? 'unknown',
      Builder: typeof builder === 'string' ? builder : 'custom',
      UserConfig: Object.keys(nuxtConfig)
        .map(key => `\`${key}\``)
        .join(', '),
      RuntimeModules: await listModules(nuxtConfig.modules),
      BuildModules: await listModules((nuxtConfig as any /* nuxt v2 */).buildModules || []),
    }

    logger.log('Working directory:', cwd)

    let maxLength = 0
    const entries = Object.entries(infoObj).map(([key, val]) => {
      const label = splitByCase(key).join(' ')
      if (label.length > maxLength) {
        maxLength = label.length
      }
      return [label, val || '-'] as const
    })
    let infoStr = ''
    for (const [label, value] of entries) {
      infoStr
        += `- ${
          (`${label}: `).padEnd(maxLength + 2)
        }${value.includes('`') ? value : `\`${value}\``
        }\n`
    }

    const copied = await clipboardy
      .write(infoStr)
      .then(() => true)
      .catch(() => false)

    const isNuxt3 = !isLegacy
    const isBridge = !isNuxt3 && infoObj.BuildModules.includes('bridge')

    const repo = isBridge ? 'nuxt/bridge' : 'nuxt/nuxt'

    const log = [
      (isNuxt3 || isBridge) && `👉 Report an issue: https://github.com/${repo}/issues/new?template=bug-report.yml`,
      (isNuxt3 || isBridge) && `👉 Suggest an improvement: https://github.com/${repo}/discussions/new`,
      `👉 Read documentation: ${(isNuxt3 || isBridge) ? 'https://nuxt.com' : 'https://v2.nuxt.com'}`,
    ].filter(Boolean).join('\n')

    const splitter = '------------------------------'
    logger.log(`Nuxt project info: ${copied ? '(copied to clipboard)' : ''}\n\n${splitter}\n${infoStr}${splitter}\n\n${log}\n`)
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
