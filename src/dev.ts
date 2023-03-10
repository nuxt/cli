import { existsSync, readdirSync } from 'node:fs'
import { resolve, relative, normalize } from 'pathe'
import chokidar from 'chokidar'
import { debounce } from 'perfect-debounce'
import type { Nuxt } from '@nuxt/schema'
import consola from 'consola'
import { getRandomPort } from 'get-port-please'
import { withTrailingSlash } from 'ufo'
import { toNodeListener } from 'h3'
import { Server } from 'node:http'
import { writeTypes } from './utils/prepare'
import { loadKit } from './utils/kit'
import {
  writeNuxtManifest,
  loadNuxtManifest,
  cleanupNuxtDirs,
} from './utils/nuxt'

async function devMain() {
  consola.info('Using experimental dev server!')
  const args = JSON.parse(process.env._CLI_ARGS_ || '{}')
  const rootDir = resolve(args._[0] || '.')

  const { loadNuxt, buildNuxt } = await loadKit(rootDir)

  let currentNuxt: Nuxt

  const setLoadingStatus = (status: string) => {
    process.send!({
      type: 'nuxt:loading',
      status,
    })
  }

  const load = async (isRestart: boolean, reason?: string) => {
    try {
      // Set loading status
      const loadingMessage = `${reason ? reason + '. ' : ''}${
        isRestart ? 'Restarting' : 'Starting'
      } nuxt...`
      if (isRestart) {
        consola.info(loadingMessage)
        setLoadingStatus(loadingMessage)
      }

      // Close previous nuxt instance
      if (currentNuxt) {
        await currentNuxt.close()
      }

      // Create new nuxt instance
      currentNuxt = await loadNuxt({ rootDir, dev: true, ready: false })

      // Support restart via hooks
      currentNuxt.hook('restart' as any, (opts: { hard: boolean }) => {
        if (opts.hard) {
          process.send!({ type: 'nuxt:restart' })
        } else {
          load(true, '`nuxt:restart` hook is called')
        }
      })

      // Start server for current nuxt instance
      const port = await getRandomPort('localhost')
      const url = `http://localhost:${port}/`
      currentNuxt.options.devServer.url = url

      // Write manifest and also check if we need cache invalidation
      if (!isRestart) {
        const previousManifest = await loadNuxtManifest(
          currentNuxt.options.buildDir
        )
        const newManifest = await writeNuxtManifest(currentNuxt)
        if (
          previousManifest &&
          newManifest &&
          previousManifest._hash !== newManifest._hash
        ) {
          await cleanupNuxtDirs(currentNuxt.options.rootDir)
        }
      }

      // Initialize Nuxt in dev mode
      await currentNuxt.ready()
      await Promise.all([
        writeTypes(currentNuxt).catch(console.error),
        buildNuxt(currentNuxt),
      ])

      // Announce server once nuxt ready
      const server: Server = await new Promise((resolve) => {
        const server = new Server(toNodeListener(currentNuxt.server.app))
        server.listen({ port, host: 'localhost' }, () => resolve(server))
      })
      await currentNuxt.hooks.callHook('listen', server, { url })
      process.send!({ type: 'nuxt:listen', url })
    } catch (err) {
      consola.error(`Cannot ${isRestart ? 'restart' : 'start'} nuxt: `, err)
      setLoadingStatus(
        'Error while loading nuxt. Please check console and fix errors.'
      )
    }
  }

  // Watch for config changes
  // TODO: Watcher service, modules, and requireTree
  const dLoad = debounce(load)
  const watcher = chokidar.watch([rootDir], { ignoreInitial: true, depth: 1 })
  watcher.on('all', (event, _file) => {
    if (!currentNuxt) {
      return
    }
    const file = normalize(_file)
    const buildDir = withTrailingSlash(normalize(currentNuxt.options.buildDir))
    if (file.startsWith(buildDir)) {
      return
    }
    const relativePath = relative(rootDir, file)
    if (
      file.match(/(nuxt\.config\.(js|ts|mjs|cjs)|\.nuxtignore|\.env|\.nuxtrc)$/)
    ) {
      dLoad(true, `${relativePath} updated`)
    }

    const isDirChange = ['addDir', 'unlinkDir'].includes(event)
    const isFileChange = ['add', 'unlink'].includes(event)
    const pagesDir = resolve(
      currentNuxt.options.srcDir,
      currentNuxt.options.dir.pages
    )
    const reloadDirs = ['components', 'composables', 'utils'].map((d) =>
      resolve(currentNuxt.options.srcDir, d)
    )

    if (isDirChange) {
      if (reloadDirs.includes(file)) {
        return dLoad(
          true,
          `Directory \`${relativePath}/\` ${
            event === 'addDir' ? 'created' : 'removed'
          }`
        )
      }
    }

    if (isFileChange) {
      if (file.match(/(app|error|app\.config)\.(js|ts|mjs|jsx|tsx|vue)$/)) {
        return dLoad(
          true,
          `\`${relativePath}\` ${event === 'add' ? 'created' : 'removed'}`
        )
      }
    }

    if (file.startsWith(pagesDir)) {
      const hasPages = existsSync(pagesDir)
        ? readdirSync(pagesDir).length > 0
        : false
      if (currentNuxt && !currentNuxt.options.pages && hasPages) {
        return dLoad(true, 'Pages enabled')
      }
      if (currentNuxt && currentNuxt.options.pages && !hasPages) {
        return dLoad(true, 'Pages disabled')
      }
    }
  })

  await load(false)
}

devMain().catch((err) => {
  console.error(err)
  process.exit(1)
})
