import { existsSync, promises as fsp } from 'node:fs'
import { dirname } from 'node:path'
import process from 'node:process'

import { styleText } from 'node:util'
import { box } from '@clack/prompts'
import { tokenizeArgs } from 'args-tokenizer'
import { defineCommand } from 'citty'
import { checkPort } from 'get-port-please'
import { resolve } from 'pathe'
import { x } from 'tinyexec'

import { parsePort, resolvePort } from '../dev/listen'
import { formatTakeoverRefusal, takeOverServer } from '../dev/takeover'
import { resolveDotenvFileNames } from '../utils/args'
import { ActionableError } from '../utils/errors'
import { loadKit } from '../utils/kit'
import { acquireLock, previewLockDir, updateLock } from '../utils/lockfile'
import { logger, outro } from '../utils/logger'
import { withPrependedPath } from '../utils/path-env'
import { relativeToProcess, resolveRootDir } from '../utils/paths'
import { resolveServerBuild } from '../utils/server-build'
import { findStaticEntry, formatServerURL, previewStaticOutput } from '../utils/static-preview'
import { dotEnvArgs, envNameArgs, extendsArgs, logLevelArgs, rootDirArgs } from './_shared'

// Other preview commands (such as `wrangler dev`) choose their own port.
const PORT_AWARE_RUNTIMES = new Set(['node', 'bun', 'deno'])
const DEFAULT_PORT = 3000

const command = defineCommand({
  meta: {
    name: 'preview',
    description: 'Launches Nitro server for local testing after `nuxt build`.',
  },
  args: {
    ...rootDirArgs,
    ...logLevelArgs,
    ...envNameArgs,
    ...extendsArgs,
    port: {
      type: 'string',
      description: 'Port to listen on (default: `NUXT_PORT || NITRO_PORT || PORT`)',
      valueHint: 'port',
      alias: ['p'],
    },
    host: {
      type: 'string',
      description: 'Host to listen on (default: `NUXT_HOST || NITRO_HOST || HOST`)',
      valueHint: 'host',
      alias: ['h'],
    },
    takeover: {
      type: 'boolean',
      description: 'Stop a preview server already running on this project and take its place',
      negativeDescription: 'Never stop a preview server already running on this project',
    },
    strictPort: {
      type: 'boolean',
      description: 'Exit if the requested port is unavailable instead of using another one',
      default: false,
    },
    ...dotEnvArgs,
  },
  async run(ctx) {
    process.env.NODE_ENV = process.env.NODE_ENV || 'production'

    const cwd = resolveRootDir(ctx.args)

    let envLoaded = false
    /** `nitro.json` location, for Nuxt versions with no build descriptor. */
    let legacyNitroJSON: string | undefined
    /** What Nuxt says about the build it would produce, when it says anything. */
    let declared: {
      label: string
      target: string | undefined
      targetLabel: string
      dir: string
      previewCommand: string | undefined
      staticDir: string | undefined
    } | undefined

    try {
      const kit = await loadKit(cwd)
      const nuxt = await kit.loadNuxt({
        cwd,
        dotenv: {
          cwd,
          fileName: resolveDotenvFileNames(ctx.args.dotenv),
        },
        envName: ctx.args.envName,
        ready: true,
        overrides: {
          ...(ctx.args.extends.length > 0 && { extends: ctx.args.extends }),
          modules: [
            function (_, nuxt) {
              envLoaded = true
              nuxt.hook('nitro:init', (nitro) => {
                legacyNitroJSON = resolve(nuxt.options.srcDir || cwd, nitro.options.output.dir || '.output', 'nitro.json')
              })
            },
          ],
        },
      })
      const build = resolveServerBuild(kit, nuxt)
      if (build.declared) {
        declared = {
          label: build.label,
          target: build.target,
          targetLabel: build.targetLabel,
          dir: build.dir,
          previewCommand: build.previewCommand,
          staticDir: build.previewStaticDir,
        }
      }
      await nuxt.close()
    }
    catch {}

    const port = ctx.args.port
      || process.env.NUXT_PORT
      || process.env.NITRO_PORT
      || process.env.PORT
    const host = ctx.args.host
      || process.env.NUXT_HOST
      || process.env.NITRO_HOST
      || process.env.HOST

    async function claimPort(): Promise<number> {
      const requestedPort = parsePort(port)
      const takeover = await takeOverServer(previewLockDir(cwd), {
        command: 'preview',
        requestedPort,
        takeover: ctx.args.takeover,
      })
      if (takeover.action === 'refused') {
        logger.error(formatTakeoverRefusal(takeover.existing, takeover.reason))
        process.exit(1)
      }
      if (takeover.action === 'taken') {
        return takeover.port
      }

      const listenPort = requestedPort ?? DEFAULT_PORT
      if (!ctx.args.strictPort) {
        return resolvePort(listenPort, host || '')
      }
      if (listenPort !== 0 && await checkPort(listenPort, host || undefined) === false) {
        throw new ActionableError(`Port ${listenPort} is already in use (\`--strictPort\` is enabled).`)
      }
      return listenPort
    }

    let previewCommand: string | undefined
    let outputPath: string | undefined
    let target: readonly [label: string, value: string] | undefined
    const searchPaths: string[] = []
    const staticDirs: string[] = []

    if (declared) {
      searchPaths.push(declared.dir)
      if (existsSync(declared.dir)) {
        previewCommand = declared.previewCommand
        outputPath = declared.dir
        if (declared.target) {
          target = [`${declared.label} ${declared.targetLabel}:`, declared.target]
        }
      }
      if (declared.staticDir) {
        staticDirs.push(declared.staticDir)
      }
    }
    else {
      // Without a descriptor, `nitro.json` is both the build marker and the
      // source of the command to run.
      const nitroJSONPaths = [...new Set([
        legacyNitroJSON,
        resolve(cwd, '.output', 'nitro.json'),
      ].filter((path): path is string => !!path))]
      searchPaths.push(...nitroJSONPaths)

      const nitroJSONPath = nitroJSONPaths.find(path => existsSync(path))
      if (nitroJSONPath) {
        const nitroJSON = JSON.parse(await fsp.readFile(nitroJSONPath, 'utf-8'))
        previewCommand = nitroJSON.commands?.preview
        outputPath = dirname(nitroJSONPath)
        if (nitroJSON.preset) {
          target = ['Nitro preset:', nitroJSON.preset]
        }
      }
    }

    staticDirs.push(resolve(cwd, '.output', 'public'))

    if (typeof previewCommand !== 'string' || !previewCommand.trim()) {
      // A build with no server runtime leaves only static files, which the CLI
      // can serve itself rather than reporting a missing server entry.
      for (const dir of staticDirs) {
        const entry = findStaticEntry(dir)
        if (entry) {
          logger.info(`This build has no server, so ${styleText('cyan', relativeToProcess(dir))} is being served statically.`)
          const listenPort = await claimPort()
          const server = await previewStaticOutput({ dir, entry, port: String(listenPort), hostname: host })
          recordPreview(cwd, listenPort, host)
          outro(`Previewing ${styleText('cyan', relativeToProcess(dir))} at ${styleText('cyan', formatServerURL(server.url))}`)
          return
        }
      }

      if (outputPath) {
        logger.error('Preview is not supported for this build.')
      }
      else {
        logger.error(
          `Cannot find a build to preview${declared ? ` for the ${styleText('cyan', declared.label)} server builder` : ''}. Did you run ${styleText('cyan', 'nuxt build')} first? Search path:\n${[...new Set([...searchPaths, ...staticDirs])].join('\n')}`,
        )
      }
      process.exit(1)
    }

    // `outputPath` is set whenever a preview command was found.
    const previewDir = outputPath!

    const [command, ...commandArgs] = tokenizeArgs(previewCommand) as [string, ...string[]]
    const listenPort = PORT_AWARE_RUNTIMES.has(command) ? await claimPort() : undefined
    const serverPort = listenPort === undefined ? port : String(listenPort)

    const info = [
      ['Node.js:', `v${process.versions.node}`],
      ...(target ? [target] : []),
      ['Working directory:', relativeToProcess(previewDir)],
    ] as const
    const _infoKeyLen = Math.max(...info.map(([label]) => label.length))

    logger.message('')
    box(
      [
        '',
        'You are previewing a Nuxt app. In production, do not use this CLI. ',
        `Instead, run ${styleText('cyan', previewCommand)} directly.`,
        '',
        ...info.map(
          ([label, value]) =>
            `${label.padEnd(_infoKeyLen, ' ')} ${styleText('cyan', value)}`,
        ),
        '',
      ].join('\n'),
      styleText('yellow', ' Previewing Nuxt app '),
      {
        contentAlign: 'left',
        titleAlign: 'left',
        width: 'auto',
        titlePadding: 2,
        contentPadding: 2,
        rounded: true,
        withGuide: true,
        formatBorder: (text: string) => styleText('yellow', text),
      },
    )

    const envFileNames = resolveDotenvFileNames(ctx.args.dotenv) ?? ['.env']
    const existing = envFileNames.filter(fileName => existsSync(resolve(cwd, fileName)))
    const missing = envFileNames.filter(fileName => !existing.includes(fileName))

    if (existing.length > 0) {
      const list = existing.map(fileName => styleText('cyan', fileName)).join(', ')
      if (envLoaded) {
        logger.info(`Loaded ${list}. This will not be loaded when running the server in production.`)
      }
      else {
        logger.warn(`Could not load Nuxt, so ${list} may not be fully applied to the preview server.`)
      }
    }

    if (ctx.args.dotenv.length > 0 && missing.length > 0) {
      logger.error(`Cannot find ${missing.map(fileName => styleText('cyan', fileName)).join(', ')}.`)
    }

    outro(`Running ${styleText('cyan', previewCommand)} in ${styleText('cyan', relativeToProcess(previewDir))}`)

    const previewLock = listenPort === undefined ? undefined : recordPreview(cwd, listenPort, host)
    try {
      const server = x(command, commandArgs, {
        throwOnError: true,
        nodeOptions: {
          stdio: 'inherit',
          cwd: previewDir,
          env: {
            ...withPrependedPath(process.env, [
              resolve(previewDir, 'node_modules/.bin'),
              resolve(cwd, 'node_modules/.bin'),
            ]),
            NUXT_PORT: serverPort,
            NITRO_PORT: serverPort,
            NUXT_HOST: host,
            NITRO_HOST: host,
          },
        },
      })
      if (server.pid) {
        previewLock?.update(server.pid)
      }
      await server
    }
    finally {
      previewLock?.release()
    }
  },
})

export default command

function recordPreview(rootDir: string, port: number, hostname: string | undefined): { update: (serverPid: number) => void, release: () => void } | undefined {
  if (port === 0) {
    return
  }
  const lockDir = previewLockDir(rootDir)
  const host = hostname || 'localhost'
  const info = {
    command: 'preview' as const,
    cwd: rootDir,
    port,
    hostname,
    url: `http://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${port}`,
  }
  const { release } = acquireLock(lockDir, info)
  if (!release) {
    return
  }
  return {
    release,
    update: serverPid => updateLock(lockDir, { ...info, serverPid }),
  }
}
