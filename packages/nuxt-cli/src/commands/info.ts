import type { NuxtModule } from '@nuxt/schema'
import type { PackageJson } from 'pkg-types'

import os from 'node:os'
import process from 'node:process'

import { styleText } from 'node:util'
import { box } from '@clack/prompts'
import { defineCommand } from 'citty'

import { detectPackageManager } from 'nypm'
import { readPackageJSON } from 'pkg-types'
import { camelCase } from 'scule'
import { isBun, isDeno, isMinimal } from 'std-env'
import { writeText } from 'tinyclip'
import { version as nuxiVersion } from '../../package.json'

import { getBuilder } from '../utils/banner'
import { resolveCatalogEntry } from '../utils/catalog'
import { withDirectStdout } from '../utils/console'
import { formatInfoBox } from '../utils/formatting'
import { tryResolveNuxt } from '../utils/kit'
import { logger } from '../utils/logger'
import { resolveNitroVersion } from '../utils/nitro'
import { getNuxtConfig } from '../utils/nuxt-config'
import { readDependencyPackageJson } from '../utils/package-json'
import { getPackageManagerVersion } from '../utils/packageManagers'
import { resolveRootDir } from '../utils/paths'
import { rootDirArgs } from './_shared'

const LEADING_SLASH_RE = /^\//

/** JSON key for each display label, so `--json` output stays stable if a label is reworded. */
const JSON_KEYS: Record<string, string> = {
  'Operating system': 'operatingSystem',
  'CPU': 'cpu',
  'Bun version': 'bunVersion',
  'Deno version': 'denoVersion',
  'Node.js version': 'nodeVersion',
  'nuxt/cli version': 'cliVersion',
  'Package manager': 'packageManager',
  'Nuxt version': 'nuxtVersion',
  'Nitro version': 'nitroVersion',
  'Builder': 'builder',
  'Config': 'config',
  'Modules': 'modules',
}

export default defineCommand({
  meta: {
    name: 'info',
    description: 'Get information about Nuxt project',
  },
  args: {
    ...rootDirArgs,
    json: {
      type: 'boolean',
      description: 'Print project info as JSON',
    },
  },
  async run(ctx) {
    const cwd = resolveRootDir(ctx.args)
    const [nuxtConfig, projectPkg, detectedPackageManager] = await Promise.all([
      getNuxtConfig(cwd),
      readPackageJSON(cwd).catch(() => ({} as PackageJson)),
      detectPackageManager(cwd),
    ])
    const { dependencies = {}, devDependencies = {} } = projectPkg
    const nuxtPath = tryResolveNuxt(cwd)
    const versions = new Map<string, Promise<string | undefined>>()
    const getDepVersion = (name: string) => {
      let version = versions.get(name)
      if (!version) {
        version = resolveDependencyVersion(name, [cwd, nuxtPath], cwd, projectPkg, dependencies, devDependencies)
        versions.set(name, version)
      }
      return version
    }

    const modulesPromise = Promise.all((nuxtConfig.modules || []).map(async (module) => {
      const name = normalizeConfigModule(module, cwd)
      if (!name) {
        return null
      }
      const specifier = Array.isArray(module) ? module[0] : module
      const packageName = typeof specifier === 'string' && getPackageName(specifier)
      const version = packageName && await getDepVersion(packageName)
      return version ? `${name}@${version}` : name
    }))
    const [modules, nuxtVersion = '-', nitroVersion] = await Promise.all([
      modulesPromise,
      getDepVersion('nuxt').then(version => version || getDepVersion('nuxt-nightly')),
      resolveNitroVersion(cwd, getDepVersion),
    ])
    const configKeys = Object.keys(nuxtConfig).sort()
    const moduleNames = modules.filter(module => module !== null)
    const builder = nuxtConfig.builder || 'vite'
    const packageManager = detectedPackageManager
      ? `${detectedPackageManager.name}@${getPackageManagerVersion(detectedPackageManager.command)}`
      : 'unknown'
    const osType = os.type()
    const cpus = os.cpus()
    const builderInfo = typeof builder === 'string' && ['vite', '@nuxt/vite-builder', 'webpack', '@nuxt/webpack-builder', 'rspack', '@nuxt/rspack-builder'].includes(builder)
      ? getBuilder(cwd, builder)
      : { name: 'custom', version: '0.0.0' }

    const infoObj = {
      'Operating system': osType === 'Darwin' ? `macOS ${os.release()}` : osType === 'Windows_NT' ? `Windows ${os.release()}` : `${osType} ${os.release()}`,
      'CPU': `${cpus[0]?.model || 'unknown'} (${cpus.length} cores)`,
      ...isBun
        // @ts-expect-error Bun global
        ? { 'Bun version': Bun?.version as string }
        : isDeno
          // @ts-expect-error Deno global
          ? { 'Deno version': Deno?.version.deno as string }
          : { 'Node.js version': process.version as string },
      'nuxt/cli version': nuxiVersion,
      'Package manager': packageManager,
      'Nuxt version': nuxtVersion,
      'Nitro version': nitroVersion,
      'Builder': builderInfo.name === 'custom' ? 'custom' : `${builderInfo.name.toLowerCase()}@${builderInfo.version}`,
      'Config': configKeys.map(key => `\`${key}\``).join(', '),
      'Modules': moduleNames.map(name => `\`${name}\``).join(', '),
    }

    if (ctx.args.json) {
      // Arrays come from the source values rather than the rendered string, so a
      // key or module path containing `, ` stays a single entry.
      const lists: Record<string, string[]> = { config: configKeys, modules: moduleNames }
      const payload = JSON.stringify({
        rootDir: nuxtConfig.rootDir || cwd,
        ...Object.fromEntries(Object.entries(infoObj).map(([label, value]) => {
          const key = JSON_KEYS[label] ?? camelCase(label)
          return [key, lists[key] ?? (value?.replaceAll('`', '') || null)]
        })),
      }, null, 2)
      await withDirectStdout(() => process.stdout.write(`${payload}\n`))
      return
    }

    logger.info(`Nuxt root directory: ${styleText('cyan', nuxtConfig.rootDir || cwd)}\n`)

    const boxStr = formatInfoBox(infoObj)

    const copyStr = formatMarkdownTable(infoObj)
    const copied = !isMinimal && await writeText(copyStr).then(() => true).catch(() => false)

    if (copied) {
      box(
        `\n${boxStr}`,
        ` Nuxt project info ${styleText('gray', '(copied to clipboard) ')}`,
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
    else {
      logger.info(`Nuxt project info:\n${copyStr}`, { withGuide: false })
    }

    logger.info(`👉 Read documentation: ${styleText('cyan', 'https://nuxt.com')}`)
    logger.info(`👉 Report an issue: ${styleText('cyan', 'https://github.com/nuxt/nuxt/issues/new?template=bug-report.yml')}`, {
      spacing: 0,
    })
    logger.info(`👉 Suggest an improvement: ${styleText('cyan', 'https://github.com/nuxt/nuxt/discussions/new')}`, {
      spacing: 0,
    })
  },
})

async function resolveDependencyVersion(
  name: string,
  roots: Array<string | null>,
  cwd: string,
  projectPkg: PackageJson,
  dependencies: Record<string, string>,
  devDependencies: Record<string, string>,
): Promise<string | undefined> {
  for (const root of roots) {
    if (!root) {
      continue
    }
    const pkg = await readDependencyPackageJson(name, root)
    if (pkg?.version) {
      return pkg.version
    }
  }
  return resolveCatalogEntry(cwd, projectPkg, name)?.specifier
    ?? dependencies[name]
    ?? devDependencies[name]
}

export function formatMarkdownTable(info: Record<string, string | undefined>): string {
  const entries = Object.entries(info).map(([label, value]) => [label, value || '-'] as const)
  const labelWidth = Math.max(...entries.map(([label]) => label.length + 4))
  const valueWidth = Math.max(...entries.map(([, value]) => value.length + (value.includes('`') ? 0 : 2)))
  const rows = entries.map(([label, value]) => {
    const formattedValue = value.includes('`') ? value : `\`${value}\``
    return `| ${`**${label}**`.padEnd(labelWidth)} | ${formattedValue.padEnd(valueWidth)} |`
  })
  return [
    `| ${' '.repeat(labelWidth)} | ${' '.repeat(valueWidth)} |`,
    `| ${'-'.repeat(labelWidth)} | ${'-'.repeat(valueWidth)} |`,
    ...rows,
    '',
  ].join('\n')
}

export function getPackageName(name: string): string | undefined {
  if (name.startsWith('.') || name.startsWith('/') || /^[a-z]:[\\/]/i.test(name) || name.endsWith('()')) {
    return undefined
  }
  const parts = name.split('/')
  return name.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

export function normalizeConfigModule(
  module: NuxtModule<any, any> | string | false | null | undefined | readonly [(NuxtModule<any, any> | string | undefined)?, unknown?],
  rootDir: string,
): string | null {
  if (!module) {
    return null
  }
  if (typeof module === 'string') {
    const normalized = module.replaceAll('\\', '/')
    const normalizedRoot = rootDir.replaceAll('\\', '/').replace(/\/$/, '')
    const nodeModulesIndex = normalized.lastIndexOf('/node_modules/')
    if (nodeModulesIndex !== -1) {
      return normalized.slice(nodeModulesIndex + '/node_modules/'.length)
    }
    return normalized.startsWith(`${normalizedRoot}/`)
      ? normalized.slice(normalizedRoot.length + 1)
      : normalized.replace(LEADING_SLASH_RE, '')
  }
  if (typeof module === 'function') {
    return `${module.name}()`
  }
  if (Array.isArray(module)) {
    return normalizeConfigModule(module[0], rootDir)
  }
  return null
}
