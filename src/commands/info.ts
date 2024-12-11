import os from 'node:os'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'pathe'
import { createJiti } from 'jiti'
import destr from 'destr'
import type { PackageJson } from 'pkg-types'
import { splitByCase } from 'scule'
import clipboardy from 'clipboardy'
import type { NuxtConfig, NuxtModule } from '@nuxt/schema'
import { defineCommand } from 'citty'
import type { packageManagerLocks } from '../utils/packageManagers'
import {
  getPackageManager,
  getPackageManagerVersion,
} from '../utils/packageManagers'
import { findup } from '../utils/fs'

import nuxiPkg from '../../package.json'
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
    const { dependencies = {}, devDependencies = {} } = findPackage(cwd)

    // Utils to query a dependency version
    const getDepVersion = (name: string) =>
      getPkg(name, cwd)?.version || dependencies[name] || devDependencies[name]

    function listModules(arr: NonNullable<NuxtConfig['modules']> = []) {
      const info: string[] = []
      for (let m of arr) {
        if (Array.isArray(m)) {
          m = m[0]
        }
        const name = normalizeConfigModule(m, cwd)
        if (name) {
          const npmName = name!.split('/').splice(0, 2).join('/') // @foo/bar/baz => @foo/bar
          const v = getDepVersion(npmName)
          info.push('`' + (v ? `${name}@${v}` : name) + '`')
        }
      }
      return info.join(', ')
    }

    // Check Nuxt version
    const nuxtVersion = getDepVersion('nuxt') || getDepVersion('nuxt-nightly') || getDepVersion('nuxt-edge') || getDepVersion('nuxt3') || '-'
    const isLegacy = nuxtVersion.startsWith('2')
    const builder = !isLegacy
      ? nuxtConfig.builder /* latest schema */ || '-'
      : (nuxtConfig as any /* nuxt v2 */).bridge?.vite
          ? 'vite' /* bridge vite implementation */
          : (nuxtConfig as any /* nuxt v2 */).buildModules?.includes('nuxt-vite')
              ? 'vite' /* nuxt-vite */
              : 'webpack'

    let packageManager: keyof typeof packageManagerLocks | 'unknown' | null
      = getPackageManager(cwd)
    if (packageManager) {
      packageManager += '@' + getPackageManagerVersion(packageManager)
    }
    else {
      packageManager = 'unknown'
    }

    const infoObj = {
      OperatingSystem: os.type(),
      NodeVersion: process.version,
      NuxtVersion: nuxtVersion,
      CLIVersion: nuxiPkg.version,
      NitroVersion: getDepVersion('nitropack'),
      PackageManager: packageManager,
      Builder: typeof builder === 'string' ? builder : 'custom',
      UserConfig: Object.keys(nuxtConfig)
        .map(key => '`' + key + '`')
        .join(', '),
      RuntimeModules: listModules(nuxtConfig.modules),
      BuildModules: listModules((nuxtConfig as any /* nuxt v2 */).buildModules || []),
    }

    console.log('Working directory:', cwd)

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
        += '- '
        + (label + ': ').padEnd(maxLength + 2)
        + (value.includes('`') ? value : '`' + value + '`')
        + '\n'
    }

    const copied = await clipboardy
      .write(infoStr)
      .then(() => true)
      .catch(() => false)
    const splitter = '------------------------------'
    console.log(
      `Nuxt project info: ${
        copied ? '(copied to clipboard)' : ''
      }\n\n${splitter}\n${infoStr}${splitter}\n`,
    )

    const isNuxt3 = !isLegacy
    const isBridge = !isNuxt3 && infoObj.BuildModules.includes('bridge')

    const repo = isBridge ? 'nuxt/bridge' : 'nuxt/nuxt'

    const log = [
      (isNuxt3 || isBridge) && `👉 Report an issue: https://github.com/${repo}/issues/new?template=bug-report.yml`,
      (isNuxt3 || isBridge) && `👉 Suggest an improvement: https://github.com/${repo}/discussions/new`,
      `👉 Read documentation: ${(isNuxt3 || isBridge) ? 'https://nuxt.com' : 'https://v2.nuxt.com'}`,
    ].filter(Boolean).join('\n')

    console.log('\n' + log + '\n')
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
    const result = await jiti.import('./nuxt.config') as NuxtConfig
    delete (globalThis as any).defineNuxtConfig
    return result
  }
  catch {
    // TODO: Show error as warning if it is not 404
    return {}
  }
}

function getPkg(name: string, rootDir: string) {
  // Assume it is in {rootDir}/node_modules/${name}/package.json
  let pkgPath = resolve(rootDir, 'node_modules', name, 'package.json')

  // Try to resolve for more accuracy
  const _require = createRequire(rootDir)
  try {
    pkgPath = _require.resolve(name + '/package.json')
  }
  catch {
    // console.log('not found:', name)
  }

  return readJSONSync(pkgPath) as PackageJson
}

function findPackage(rootDir: string) {
  return (
    findup(rootDir, (dir) => {
      const p = resolve(dir, 'package.json')
      if (existsSync(p)) {
        return readJSONSync(p) as PackageJson
      }
    }) || {}
  )
}

function readJSONSync(filePath: string) {
  try {
    return destr(readFileSync(filePath, 'utf-8'))
  }
  catch {
    // TODO: Warn error
    return null
  }
}
