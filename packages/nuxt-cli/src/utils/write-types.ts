import { spawn } from 'node:child_process'
import { once } from 'node:events'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { resolveDotenvFileNames } from './args'
import { ActionableError } from './errors'
import { loadKit } from './kit'

export interface WriteTypesOptions {
  cwd: string
  dotenv?: string[]
  logLevel?: 'silent' | 'info' | 'verbose'
  overrides?: Record<string, any>
}

/** Load Nuxt in this process, write its types and build its templates. */
export async function writeTypes(options: WriteTypesOptions): Promise<void> {
  const { cwd, dotenv, logLevel, overrides } = options
  const { loadNuxt, buildNuxt, writeTypes } = await loadKit(cwd)
  const nuxt = await loadNuxt({
    cwd,
    dotenv: { cwd, fileName: resolveDotenvFileNames(dotenv) },
    overrides: {
      _prepare: true,
      logLevel,
      ...overrides,
    },
  })

  try {
    await writeTypes(nuxt)
    await buildNuxt(nuxt)
  }
  finally {
    await nuxt.close()
  }
}

/**
 * Run {@link writeTypes} in a short-lived Node.js process, so this one does not
 * keep Nuxt in memory afterwards. `options` must be JSON-serialisable.
 */
export async function writeTypesInChild(options: WriteTypesOptions): Promise<void> {
  const entry = fileURLToPath(new URL('./write-types.mjs', import.meta.url))
  const child = spawn(process.execPath, [entry, JSON.stringify(options)], {
    cwd: options.cwd,
    stdio: 'inherit',
  })
  const [code, signal] = await once(child, 'exit') as [number | null, NodeJS.Signals | null]
  if (signal) {
    throw new ActionableError(`Generating types was terminated by ${signal}.`)
  }
  if (code !== 0) {
    throw new ActionableError(`Generating types failed with exit code ${code}. Fix the error above and try again.`)
  }
}
