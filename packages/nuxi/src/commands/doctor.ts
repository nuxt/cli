import type { Nuxt } from '@nuxt/schema'

import process from 'node:process'

import { intro, log, outro } from '@clack/prompts'
import { defineCommand } from 'citty'
import { colors } from 'consola/utils'
import { resolve } from 'pathe'
import { readPackageJSON } from 'pkg-types'
import { satisfies as semverSatisfies } from 'semver'
import { isBun, isDeno } from 'std-env'

import { loadKit, tryResolveNuxt } from '../utils/kit'
import { cwdArgs, legacyRootDirArgs, logLevelArgs } from './_shared'

interface DoctorCheck {
  // Required
  name: string
  status: 'success' | 'warning' | 'error'
  message: string

  // Optional - identity/origin
  id?: string // programmatic code: "MISSING_PEER_DEP"
  source?: string // module name: "@nuxt/ui"

  // Optional - verbose fields
  details?: string | string[]
  suggestion?: string
  url?: string

  // Optional - programmatic
  data?: Record<string, unknown>
}

interface DoctorCheckContext {
  addCheck: (check: DoctorCheck) => void
  nuxt: Nuxt
}

declare module '@nuxt/schema' {
  interface NuxtHooks {
    'doctor:check': (ctx: DoctorCheckContext) => void | Promise<void>
  }
}

const plural = (n: number) => n === 1 ? '' : 's'

async function resolveNuxtVersion(cwd: string): Promise<string | undefined> {
  const nuxtPath = tryResolveNuxt(cwd)
  for (const pkg of ['nuxt', 'nuxt-nightly', 'nuxt-edge', 'nuxt3']) {
    try {
      const pkgJson = await readPackageJSON(pkg, { url: nuxtPath || cwd })
      if (pkgJson?.version)
        return pkgJson.version
    }
    catch (err: any) {
      // Ignore "not found" errors, log unexpected ones
      if (err?.code !== 'ERR_MODULE_NOT_FOUND' && err?.code !== 'ENOENT' && !err?.message?.includes('Cannot find'))
        log.warn(`Failed to read ${pkg} version: ${err?.message || err}`)
    }
  }
}

export default defineCommand({
  meta: {
    name: 'doctor',
    description: 'Run diagnostic checks on Nuxt project',
  },
  args: {
    ...cwdArgs,
    ...legacyRootDirArgs,
    ...logLevelArgs,
    verbose: {
      type: 'boolean',
      description: 'Show details, suggestions, and URLs',
    },
    json: {
      type: 'boolean',
      description: 'Output results as JSON',
    },
  },
  async run(ctx) {
    const cwd = resolve(ctx.args.cwd || ctx.args.rootDir)
    const fancy = Boolean(process.stdout.isTTY)

    if (!ctx.args.json && fancy)
      intro(colors.cyan('Running diagnostics...'))

    const { loadNuxt } = await loadKit(cwd)

    let nuxt: Nuxt
    try {
      nuxt = await loadNuxt({
        cwd,
        ready: true,
        overrides: {
          logLevel: ctx.args.logLevel as 'silent' | 'info' | 'verbose' | undefined,
        },
      })
    }
    catch (err) {
      if (ctx.args.json) {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify([{ name: 'Nuxt', status: 'error', message: `Failed to load Nuxt: ${err instanceof Error ? err.message : String(err)}` }]))
      }
      else if (fancy) {
        log.error(colors.red(`Failed to load Nuxt: ${err instanceof Error ? err.message : String(err)}`))
        outro(colors.red('Diagnostics failed'))
      }
      else {
        // eslint-disable-next-line no-console
        console.error(`Failed to load Nuxt: ${err instanceof Error ? err.message : String(err)}`)
      }
      return process.exit(1)
    }

    const checks: DoctorCheck[] = []

    try {
      await runCoreChecks(checks, nuxt, cwd)

      const addCheck = (c: DoctorCheck) => {
        const validStatus = c?.status === 'success' || c?.status === 'warning' || c?.status === 'error'
        if (!c?.name || !c?.message || !validStatus) {
          checks.push({
            id: 'INVALID_DOCTOR_CHECK',
            name: 'Doctor',
            status: 'error',
            message: 'Invalid doctor:check payload from module',
            source: c?.source,
            data: { received: c },
          })
          return
        }
        checks.push(c)
      }

      try {
        await nuxt.callHook('doctor:check', { addCheck, nuxt })
      }
      catch (err) {
        checks.push({
          id: 'DOCTOR_HOOK_FAILED',
          name: 'Doctor',
          status: 'error',
          message: `doctor:check hook failed: ${err instanceof Error ? err.message : String(err)}`,
        })
      }

      displayResults(checks, { verbose: ctx.args.verbose, json: ctx.args.json, fancy })
    }
    finally {
      await nuxt.close()
    }

    const hasErrors = checks.some(c => c.status === 'error')
    const hasWarnings = checks.some(c => c.status === 'warning')

    if (!ctx.args.json && fancy) {
      if (hasErrors)
        outro(colors.red('Diagnostics complete with errors'))
      else if (hasWarnings)
        outro(colors.yellow('Diagnostics complete with warnings'))
      else
        outro(colors.green('All checks passed!'))
    }
    else if (!ctx.args.json) {
      // eslint-disable-next-line no-console
      console.log(hasErrors ? 'Diagnostics complete with errors' : hasWarnings ? 'Diagnostics complete with warnings' : 'All checks passed!')
    }

    if (hasErrors)
      process.exit(1)
  },
})

async function runCoreChecks(checks: DoctorCheck[], nuxt: Nuxt, cwd: string): Promise<void> {
  const runCheck = async (name: string, fn: () => void | Promise<void>) => {
    try {
      await fn()
    }
    catch (err) {
      checks.push({ name, status: 'error', message: `Check failed: ${err instanceof Error ? err.message : String(err)}` })
    }
  }

  await runCheck('Versions', () => checkVersions(checks, cwd))
  await runCheck('Config', () => checkConfig(checks, nuxt))
  await runCheck('Modules', () => checkModuleCompat(checks, nuxt, cwd))
}

async function checkVersions(checks: DoctorCheck[], cwd: string): Promise<void> {
  const runtime = isBun
    // @ts-expect-error Bun global
    ? `Bun ${Bun?.version}`
    : isDeno
      // @ts-expect-error Deno global
      ? `Deno ${Deno?.version.deno}`
      : `Node ${process.version}`

  const nuxtVersion = await resolveNuxtVersion(cwd) ?? 'unknown'

  // Check Node.js version (if not Bun/Deno)
  if (!isBun && !isDeno) {
    if (!semverSatisfies(process.versions.node, '>= 18.0.0')) {
      checks.push({
        id: 'UNSUPPORTED_NODE',
        name: 'Versions',
        status: 'error',
        message: `${runtime}, Nuxt ${nuxtVersion} - Node.js 18+ required`,
        suggestion: 'Upgrade Node.js to v18 or later',
        url: 'https://nuxt.com/docs/getting-started/installation#prerequisites',
      })
      return
    }
  }

  checks.push({
    name: 'Versions',
    status: 'success',
    message: `${runtime}, Nuxt ${nuxtVersion}`,
  })
}

function checkConfig(checks: DoctorCheck[], nuxt: Nuxt): void {
  const issues: string[] = []

  // Check for common misconfigurations
  if (nuxt.options.ssr === false && nuxt.options.nitro?.prerender?.routes?.length) {
    issues.push('prerender routes defined but SSR is disabled')
  }

  // Check for deprecated options
  if ((nuxt.options as any).target) {
    issues.push('deprecated "target" option - use ssr + nitro.preset instead')
  }

  if ((nuxt.options as any).mode) {
    issues.push('deprecated "mode" option - use ssr: true/false instead')
  }

  // Check for missing compatibilityDate
  if (!nuxt.options.compatibilityDate) {
    issues.push('missing "compatibilityDate" - add to nuxt.config.ts for future compat')
  }

  if (issues.length > 0) {
    checks.push({
      id: 'CONFIG_ISSUES',
      name: 'Config',
      status: 'warning',
      message: `${issues.length} issue${plural(issues.length)} found`,
      details: issues,
      suggestion: 'Review nuxt.config.ts and fix the issues above',
      url: 'https://nuxt.com/docs/getting-started/configuration',
    })
  }
  else {
    checks.push({
      name: 'Config',
      status: 'success',
      message: 'no issues',
    })
  }
}

async function checkModuleCompat(checks: DoctorCheck[], nuxt: Nuxt, cwd: string): Promise<void> {
  const nuxtVersion = await resolveNuxtVersion(cwd)
  if (!nuxtVersion) {
    checks.push({
      name: 'Modules',
      status: 'warning',
      message: 'could not determine Nuxt version for compatibility check',
    })
    return
  }

  const installedModules: { meta?: { name?: string, version?: string, compatibility?: { nuxt?: string } } }[] = (nuxt.options as any)._installedModules || []
  const moduleDetails: string[] = []
  const issues: string[] = []

  for (const mod of installedModules) {
    if (!mod.meta?.name)
      continue

    const name = mod.meta.name
    const version = mod.meta.version ? `@${mod.meta.version}` : ''
    const compat = mod.meta.compatibility

    if (compat?.nuxt && !semverSatisfies(nuxtVersion, compat.nuxt, { includePrerelease: true })) {
      issues.push(`${name}${version} - requires nuxt ${compat.nuxt}`)
    }
    else {
      moduleDetails.push(`${name}${version}`)
    }
  }

  if (issues.length > 0) {
    checks.push({
      id: 'MODULE_COMPAT',
      name: 'Modules',
      status: 'warning',
      message: `${issues.length} incompatible module${plural(issues.length)}`,
      details: issues,
      suggestion: 'Update modules to versions compatible with your Nuxt version',
      url: 'https://nuxt.com/modules',
    })
  }
  else if (moduleDetails.length > 0) {
    checks.push({
      name: 'Modules',
      status: 'success',
      message: `${moduleDetails.length} module${plural(moduleDetails.length)} loaded`,
      details: moduleDetails,
    })
  }
  else {
    checks.push({
      name: 'Modules',
      status: 'success',
      message: 'no modules installed',
    })
  }
}

const statusStyles = {
  fancy: {
    success: { icon: '✓', color: colors.green, detailColor: colors.dim },
    warning: { icon: '!', color: colors.yellow, detailColor: colors.yellow },
    error: { icon: '✗', color: colors.red, detailColor: colors.red },
  },
  plain: {
    success: { icon: 'OK', color: colors.green, detailColor: colors.dim },
    warning: { icon: 'WARN', color: colors.yellow, detailColor: colors.yellow },
    error: { icon: 'ERR', color: colors.red, detailColor: colors.red },
  },
} as const

function displayResults(checks: DoctorCheck[], opts: { verbose?: boolean, json?: boolean, fancy?: boolean }): void {
  if (opts.json) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(checks))
    return
  }

  const fancy = opts.fancy !== false
  const writeLine = fancy ? log.message : (line: string) => console.log(line)
  const styles = fancy ? statusStyles.fancy : statusStyles.plain
  const detailMarker = fancy ? '→' : '->'
  const suggestionMarker = fancy ? '💡' : 'Tip:'
  const urlMarker = fancy ? '🔗' : 'URL:'

  for (const check of checks) {
    const style = styles[check.status]
    const icon = style.color(style.icon)
    const source = check.source ? colors.gray(` (via ${check.source})`) : ''
    const name = colors.bold(check.name)
    const message = check.status === 'success' ? check.message : style.color(check.message)

    let output = `[${icon}] ${name}${source} - ${message}`

    const details = [check.details ?? []].flat()
    if (details.length) {
      for (const detail of details)
        output += `\n    ${style.detailColor(detailMarker)} ${style.detailColor(detail)}`
    }

    // Verbose: show suggestion and url
    if (opts.verbose) {
      if (check.suggestion) {
        output += `\n    ${colors.cyan(suggestionMarker)} ${colors.cyan(check.suggestion)}`
      }
      if (check.url) {
        output += `\n    ${colors.blue(urlMarker)} ${colors.blue(check.url)}`
      }
    }

    writeLine(output)
  }
}
