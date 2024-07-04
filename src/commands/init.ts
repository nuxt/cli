import { downloadTemplate, startShell } from 'giget'
import type { DownloadTemplateResult } from 'giget'
import { relative, resolve, dirname, join } from 'pathe'
import { consola } from 'consola'
import type { PackageManagerName } from 'nypm'
import { defineCommand } from 'citty'
import nunjucks from 'nunjucks'

import { sharedArgs } from './_shared'
import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'
import { updateConfig } from 'c12/update'
import { readPackageJson, writePackageJson } from '../utils/packageJson'

const DEFAULT_REGISTRY =
  'https://raw.githubusercontent.com/nuxt/starter/templates/templates'
const DEFAULT_TEMPLATE_NAME = 'v3'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export default defineCommand({
  meta: {
    name: 'init',
    description: 'Initialize a fresh project',
  },
  args: {
    ...sharedArgs,
    dir: {
      type: 'positional',
      description: 'Project directory',
      default: '',
    },
    template: {
      type: 'string',
      alias: 't',
      description: 'Template name',
    },
    force: {
      type: 'boolean',
      alias: 'f',
      description: 'Override existing directory',
    },
    offline: {
      type: 'boolean',
      description: 'Force offline mode',
    },
    preferOffline: {
      type: 'boolean',
      description: 'Prefer offline mode',
    },
    install: {
      type: 'boolean',
      default: true,
      description: 'Skip installing dependencies',
    },
    gitInit: {
      type: 'boolean',
      description: 'Initialize git repository',
    },
    shell: {
      type: 'boolean',
      description: 'Start shell after installation in project directory',
    },
    packageManager: {
      type: 'string',
      description: 'Package manager choice (npm, pnpm, yarn, bun)',
    },
  },
  async run(ctx) {
    const cwd = resolve(ctx.args.cwd || '.')

    const templateName = ctx.args.template || DEFAULT_TEMPLATE_NAME

    const selectedPackageManager = await resolvePackageManager(
      ctx.args.packageManager as PackageManagerName
    )

    const selectedFeatures = (await consola.prompt(
      'Select additional features',
      {
        type: 'multiselect',
        required: false,
        options: [
          {
            value: 'eslint',
            label: 'Add ESLint for code linting',
          },
          {
            value: 'prettier',
            label: 'Add Prettier for code formatting',
          },
          {
            value: 'playwright',
            label: 'Add Playwright for browser testing',
          },
          {
            value: 'vitest',
            label: 'Add Vitest for unit testing',
          },
        ],
      }
    )) as any as string[]
    const features = Object.fromEntries(
      selectedFeatures.map((value) => [value, true])
    )

    if (ctx.args.gitInit === undefined) {
      ctx.args.gitInit = await consola.prompt('Initialize git repository?', {
        type: 'confirm',
      })
    }

    if (typeof templateName !== 'string') {
      consola.error('Please specify a template!')
      process.exit(1)
    }

    // Download template
    let template: DownloadTemplateResult

    try {
      template = await downloadTemplate(templateName, {
        dir: ctx.args.dir,
        cwd,
        force: Boolean(ctx.args.force),
        offline: Boolean(ctx.args.offline),
        preferOffline: Boolean(ctx.args.preferOffline),
        registry: process.env.NUXI_INIT_REGISTRY || DEFAULT_REGISTRY,
      })
    } catch (err) {
      if (process.env.DEBUG) {
        throw err
      }
      consola.error((err as Error).toString())
      process.exit(1)
    }

    const templateDir = join(__dirname, '..', 'partial-templates')
    const engine = nunjucks.configure(templateDir, {
      autoescape: false,
      trimBlocks: true,
    })
    const templateCtx = {
      ...features,
      packageManager: selectedPackageManager,
    }

    if (features.prettier) {
      renderPrettierFiles(engine, template.dir, templateCtx)
    }
    if (features.eslint) {
      renderEslintFiles(engine, template.dir, templateCtx)
    }
    await renderPackageJson(template.dir, features)

    // Install project dependencies
    // or skip installation based on the '--no-install' flag
    // if (ctx.args.install === false) {
    //   consola.info('Skipping install dependencies step.')
    // } else {
    //   consola.start('Installing dependencies...')

    //   try {
    //     await installDependencies({
    //       cwd: template.dir,
    //       packageManager: {
    //         name: selectedPackageManager,
    //         command: selectedPackageManager,
    //       },
    //     })
    //   } catch (err) {
    //     if (process.env.DEBUG) {
    //       throw err
    //     }
    //     consola.error((err as Error).toString())
    //     process.exit(1)
    //   }

    //   consola.success('Installation completed.')
    // }

    // if (ctx.args.gitInit) {
    //   await initializeGitRepository(template.dir)
    // }

    // Display next steps
    consola.log(
      `\n✨ Nuxt project has been created with the \`${template.name}\` template. Next steps:`
    )
    const relativeTemplateDir = relative(process.cwd(), template.dir) || '.'
    const nextSteps = [
      !ctx.args.shell &&
        relativeTemplateDir.length > 1 &&
        `\`cd ${relativeTemplateDir}\``,
      `Start development server with \`${selectedPackageManager} run dev\``,
    ].filter(Boolean)

    for (const step of nextSteps) {
      consola.log(` › ${step}`)
    }

    if (ctx.args.shell) {
      startShell(template.dir)
    }
  },
})

async function resolvePackageManager(packageManager: PackageManagerName) {
  const packageManagerOptions: PackageManagerName[] = [
    'npm',
    'pnpm',
    'yarn',
    'bun',
  ]

  const isSupportedPackageManager =
    packageManagerOptions.includes(packageManager)

  return isSupportedPackageManager
    ? packageManager
    : await consola.prompt('Which package manager would you like to use?', {
        type: 'select',
        options: packageManagerOptions,
      })
}

function renderPrettierFiles(
  engine: nunjucks.Environment,
  dir: string,
  ctx: any
) {
  writeFileSync(
    join(dir, '.prettierrc.mjs'),
    engine.render('prettier/.prettierrc.mjs', { ctx })
  )
  writeFileSync(
    join(dir, '.prettierignore'),
    engine.render('prettier/.prettierignore.njk', { ctx })
  )
}

function renderEslintFiles(
  engine: nunjucks.Environment,
  dir: string,
  ctx: any
) {
  writeFileSync(
    join(dir, 'eslint.config.mjs'),
    engine.render('eslint/eslint.config.mjs', { ctx })
  )
}

async function renderPackageJson(
  dir: string,
  features: Record<string, boolean>
) {
  const pkgJson = await readPackageJson(dir)
  if (features.prettier) {
    pkgJson.devDependencies ??= {}
    pkgJson.devDependencies['prettier'] = 'latest'

    if (features.eslint) {
      pkgJson.scripts!['lint'] = 'prettier --check . && eslint .'
    } else {
      pkgJson.scripts!['lint'] = 'prettier --check .'
    }
    pkgJson.scripts!['format'] = 'prettier --write .'
  }
  if (features.eslint) {
    pkgJson.devDependencies ??= {}
    pkgJson.devDependencies['eslint'] = 'latest'
    pkgJson.devDependencies['@nuxt/eslint'] = 'latest'

    if (!features.prettier) {
      pkgJson.scripts!['lint'] = 'eslint .'
    }

    await updateConfig({
      cwd: dir,
      configFile: 'nuxt.config',
      async onUpdate(config) {
        if (!config.modules) {
          config.modules = []
        }
        if (config.modules.includes('@nuxt/eslint')) {
          return
        }
        config.modules.push('@nuxt/eslint')
      },
    })
  }
  writePackageJson(dir, pkgJson)
}

async function initializeGitRepository(templateDir: string) {
  consola.info('Initializing git repository...\n')
  const { execa } = await import('execa')
  await execa('git', ['init', templateDir], {
    stdio: 'inherit',
  }).catch((err) => {
    consola.warn(`Failed to initialize git repository: ${err}`)
  })
}
