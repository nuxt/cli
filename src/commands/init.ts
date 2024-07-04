import { downloadTemplate, startShell } from 'giget'
import type { DownloadTemplateResult } from 'giget'
import { relative, resolve, dirname, join } from 'pathe'
import { consola } from 'consola'
import { installDependencies, type PackageManagerName } from 'nypm'
import { defineCommand } from 'citty'
import nunjucks from 'nunjucks'

import { sharedArgs } from './_shared'
import { fileURLToPath } from 'node:url'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
    if (features.playwright) {
      renderPlaywrightFiles(engine, template.dir, templateCtx)
    }
    if (features.vitest) {
      renderVitestFiles(engine, template.dir, templateCtx)
    }

    await renderPackageJson(template.dir, features)

    // Install project dependencies
    // or skip installation based on the '--no-install' flag
    if (ctx.args.install === false) {
      consola.info('Skipping install dependencies step.')
    } else {
      consola.start('Installing dependencies...')
      await installProjectDependencies(template.dir, selectedPackageManager)
      consola.success('Installation completed.')
    }

    if (ctx.args.gitInit) {
      await initializeGitRepository(template.dir)
    }

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
    engine.render('eslint/eslint.config.mjs.njk', { ctx })
  )
}

function renderPlaywrightFiles(
  engine: nunjucks.Environment,
  dir: string,
  ctx: any
) {
  writeFileSync(
    join(dir, 'playwright.config.ts'),
    engine.render('playwright/playwright.config.ts', { ctx })
  )
  mkdirSync(join(dir, 'e2e'), { recursive: true })
  writeFileSync(
    join(dir, 'e2e', 'index.spec.ts'),
    engine.render('playwright/e2e/index.spec.ts', { ctx })
  )

  const ignorePathPatterns = [
    '/test-results/',
    '/playwright-report/',
    '/blob-report/',
    '/playwright/.cache/',
  ]
  const ignorePaths = `\n#Playwright\n${ignorePathPatterns.join('\n')}\n`
  writeFileSync(join(dir, '.nuxtignore'), ignorePaths)

  const gitignoreContents = readFileSync(join(dir, '.gitignore'), {
    encoding: 'utf8',
  })
  writeFileSync(join(dir, '.gitignore'), gitignoreContents + ignorePaths)
}

function renderVitestFiles(
  engine: nunjucks.Environment,
  dir: string,
  ctx: any
) {
  writeFileSync(
    join(dir, 'app.spec.ts'),
    engine.render('vitest/vitest.config.mts', { ctx })
  )
  writeFileSync(
    join(dir, 'app.spec.ts'),
    engine.render('vitest/app.spec.ts', { ctx })
  )
}

async function renderPackageJson(
  dir: string,
  features: Record<string, boolean>
) {
  const pkgJson = await readPackageJson(dir)
  if (features.prettier) {
    pkgJson.devDependencies ??= {}
    pkgJson.devDependencies['prettier'] = '^3.1.1'

    if (features.eslint) {
      pkgJson.scripts!['lint'] = 'prettier --check . && eslint .'
    } else {
      pkgJson.scripts!['lint'] = 'prettier --check .'
    }
    pkgJson.scripts!['format'] = 'prettier --write .'
  }
  if (features.eslint) {
    pkgJson.devDependencies ??= {}
    pkgJson.devDependencies['eslint'] = '^9.0.0'
    pkgJson.devDependencies['@nuxt/eslint'] = '^0.3.13'

    if (!features.prettier) {
      pkgJson.scripts!['lint'] = 'eslint .'
    }

    await addModuleToNuxtConfig(dir, '@nuxt/eslint')
  }
  if (features.playwright) {
    pkgJson.devDependencies ??= {}
    pkgJson.devDependencies['@playwright/test'] = '^1.28.1'
    if (features.eslint) {
      pkgJson.devDependencies['eslint-plugin-playwright'] = '^1.6.2'
    }

    if (features.vitest) {
      pkgJson.scripts!['test:e2e'] = 'playwright test'
      pkgJson.scripts!['test:unit'] = 'vitest run'
      pkgJson.scripts!['test'] = 'npm run test:unit && npm run test:e2e'
    } else {
      pkgJson.scripts!['test'] = 'playwright test'
    }
  }
  if (features.vitest) {
    pkgJson.devDependencies ??= {}
    pkgJson.devDependencies['@nuxt/test-utils'] = '^3.13.1'
    pkgJson.devDependencies['@testing-library/vue'] = '^8.1.0'
    pkgJson.devDependencies['@vue/test-utils'] = '^2.4.6'
    pkgJson.devDependencies['happy-dom'] = '^14.12.3'
    pkgJson.devDependencies['vitest'] = '^1.6.0'

    await addModuleToNuxtConfig(dir, '@nuxt/test-utils')

    if (!features.playwright) {
      pkgJson.scripts!['test'] = 'vitest run'
    }
  }
  writePackageJson(dir, pkgJson)
}

async function installProjectDependencies(
  dir: string,
  packageManager: PackageManagerName
) {
  try {
    await installDependencies({
      cwd: dir,
      packageManager: {
        name: packageManager,
        command: packageManager,
      },
    })
  } catch (err) {
    if (process.env.DEBUG) {
      throw err
    }
    consola.error((err as Error).toString())
    process.exit(1)
  }
}

async function addModuleToNuxtConfig(dir: string, moduleName: string) {
  return await updateConfig({
    cwd: dir,
    configFile: 'nuxt.config',
    async onUpdate(config) {
      if (!config.modules) {
        config.modules = []
      }
      if (!config.modules.includes(moduleName)) {
        config.modules.push(moduleName)
      }
    },
  })
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
