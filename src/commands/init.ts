import { fileURLToPath } from 'node:url'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { downloadTemplate, startShell } from 'giget'
import type { DownloadTemplateResult } from 'giget'
import { relative, resolve, dirname, join } from 'pathe'
import { consola } from 'consola'
import { installDependencies, type PackageManagerName } from 'nypm'
import { defineCommand } from 'citty'
import type nunjucks from 'nunjucks'

import { updateConfig } from 'c12/update'
import { readPackageJson, writePackageJson } from '../utils/packageJson'
import { sharedArgs } from './_shared'

const DEFAULT_REGISTRY
  = 'https://raw.githubusercontent.com/nuxt/starter/templates/templates'
const DEFAULT_TEMPLATE_NAME = 'v3'

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
    skipExtras: {
      type: 'boolean',
      description: 'Skip setting up any extra technology',
    },
  },
  async run(ctx) {
    const cwd = resolve(ctx.args.cwd || '.')

    const templateName = ctx.args.template || DEFAULT_TEMPLATE_NAME

    const selectedPackageManager = await resolvePackageManager(
      ctx.args.packageManager as PackageManagerName,
    )

    const extraFeatures = await resolveExtraFeatures(ctx.args.skipExtras)

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
    }
    catch (err) {
      if (process.env.DEBUG) {
        throw err
      }
      consola.error((err as Error).toString())
      process.exit(1)
    }

    if (anyExtraSelected(extraFeatures)) {
      setupExtras(template, selectedPackageManager, extraFeatures)
    }

    // Install project dependencies
    // or skip installation based on the '--no-install' flag
    if (ctx.args.install === false) {
      consola.info('Skipping install dependencies step.')
    }
    else {
      consola.start('Installing dependencies...')
      await installProjectDependencies(template.dir, selectedPackageManager)
      consola.success('Installation completed.')
    }

    if (ctx.args.gitInit) {
      await initializeGitRepository(template.dir)
    }

    // Display next steps
    consola.log(
      `\n✨ Nuxt project has been created with the \`${template.name}\` template. Next steps:`,
    )
    const relativeTemplateDir = relative(process.cwd(), template.dir) || '.'
    const nextSteps = [
      !ctx.args.shell
      && relativeTemplateDir.length > 1
      && `\`cd ${relativeTemplateDir}\``,
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

interface ExtraFeatures {
  eslint: boolean
  prettier: boolean
  playwright: boolean
  vitest: boolean
  vscode: boolean
}

async function resolveExtraFeatures(
  skipExtras: boolean,
): Promise<ExtraFeatures> {
  const DEFAULT = {
    eslint: false,
    prettier: false,
    playwright: false,
    vitest: false,
    vscode: false,
  }
  if (skipExtras) {
    return DEFAULT
  }

  const selectedExtras = await consola.prompt('Select extra features', {
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
      {
        value: 'vscode',
        label: 'Setup configuration for VSCode',
      },
    ],
  })

  const selectedExtrasObject = Object.fromEntries(
    selectedExtras.map(extra => [extra, true]),
  )
  return {
    ...DEFAULT,
    ...selectedExtrasObject,
  }
}

function anyExtraSelected(extras: ExtraFeatures) {
  return Object.values(extras).some(extra => !!extra)
}

async function resolvePackageManager(packageManager: PackageManagerName) {
  const packageManagerOptions: PackageManagerName[] = [
    'npm',
    'pnpm',
    'yarn',
    'bun',
  ]

  const isSupportedPackageManager
    = packageManagerOptions.includes(packageManager)

  return isSupportedPackageManager
    ? packageManager
    : await consola.prompt('Which package manager would you like to use?', {
      type: 'select',
      options: packageManagerOptions,
    })
}

async function setupExtras(
  template: DownloadTemplateResult,
  packageManager: PackageManagerName,
  extras: ExtraFeatures,
) {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const templateDir = join(__dirname, '..', 'partial-templates')
  const nunjucks = await import('nunjucks')
  const engine = nunjucks.configure(templateDir, {
    autoescape: false,
    lstripBlocks: true,
    trimBlocks: true,
  })
  const templateCtx: TemplateContext = {
    ...extras,
    packageManager,
  }

  if (extras.prettier) {
    renderPrettierFiles(engine, template.dir, templateCtx)
  }
  if (extras.eslint) {
    renderEslintFiles(engine, template.dir, templateCtx)
  }
  if (extras.playwright) {
    renderPlaywrightFiles(engine, template.dir, templateCtx)
  }
  if (extras.vitest) {
    renderVitestFiles(engine, template.dir, templateCtx)
  }
  if (extras.vscode) {
    renderVSCodeFiles(engine, template.dir, templateCtx)
  }
  await renderPackageJson(template.dir, extras)
}

interface TemplateContext extends ExtraFeatures {
  packageManager: PackageManagerName
}

function renderPrettierFiles(
  engine: nunjucks.Environment,
  dir: string,
  ctx: TemplateContext,
) {
  writeFileSync(
    join(dir, '.prettierrc.mjs'),
    engine.render('prettier/.prettierrc.mjs', { ctx }),
  )
  writeFileSync(
    join(dir, '.prettierignore'),
    engine.render('prettier/.prettierignore.njk', { ctx }),
  )
}

function renderEslintFiles(
  engine: nunjucks.Environment,
  dir: string,
  ctx: TemplateContext,
) {
  writeFileSync(
    join(dir, 'eslint.config.mjs'),
    engine.render('eslint/eslint.config.mjs.njk', { ctx }),
  )
}

function renderPlaywrightFiles(
  engine: nunjucks.Environment,
  dir: string,
  ctx: TemplateContext,
) {
  writeFileSync(
    join(dir, 'playwright.config.ts'),
    engine.render('playwright/playwright.config.ts', { ctx }),
  )
  mkdirSync(join(dir, 'e2e'), { recursive: true })
  writeFileSync(
    join(dir, 'e2e', 'index.spec.ts'),
    engine.render('playwright/e2e/index.spec.ts', { ctx }),
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
  ctx: TemplateContext,
) {
  writeFileSync(
    join(dir, 'vitest.config.mts'),
    engine.render('vitest/vitest.config.mts.njk', { ctx }),
  )
  writeFileSync(
    join(dir, 'app.spec.ts'),
    engine.render('vitest/app.spec.ts', { ctx }),
  )
}

function renderVSCodeFiles(
  engine: nunjucks.Environment,
  dir: string,
  ctx: TemplateContext,
) {
  mkdirSync(join(dir, '.vscode'), { recursive: true })
  writeFileSync(
    join(dir, '.vscode', 'extensions.json'),
    engine.render('vscode/extensions.json.njk', { ctx }),
  )
  writeFileSync(
    join(dir, '.vscode', 'settings.json'),
    engine.render('vscode/settings.json.njk', { ctx }),
  )
}

async function renderPackageJson(dir: string, features: ExtraFeatures) {
  const pkgJson = await readPackageJson(dir)
  pkgJson.scripts ??= {}
  pkgJson.devDependencies ??= {}

  if (features.prettier) {
    pkgJson.devDependencies['prettier'] = '^3.1.1'

    if (features.eslint) {
      pkgJson.scripts['lint'] = 'prettier --check . && eslint .'
    }
    else {
      pkgJson.scripts['lint'] = 'prettier --check .'
    }
    pkgJson.scripts['format'] = 'prettier --write .'
  }
  if (features.eslint) {
    pkgJson.devDependencies['eslint'] = '^9.0.0'
    pkgJson.devDependencies['@nuxt/eslint'] = '^0.3.13'

    if (!features.prettier) {
      pkgJson.scripts['lint:fix'] = 'eslint . --fix'
      pkgJson.scripts['lint'] = 'eslint .'
    }
    else {
      pkgJson.scripts['eslint:fix'] = 'eslint . --fix'
    }

    await addModuleToNuxtConfig(dir, '@nuxt/eslint')
  }
  if (features.playwright) {
    pkgJson.devDependencies['@playwright/test'] = '^1.28.1'
    if (features.eslint) {
      pkgJson.devDependencies['eslint-plugin-playwright'] = '^1.6.2'
    }

    if (features.vitest) {
      pkgJson.scripts['test:e2e'] = 'playwright test'
      pkgJson.scripts['test:unit'] = 'vitest run'
      pkgJson.scripts['test'] = 'npm run test:unit && npm run test:e2e'
    }
    else {
      pkgJson.scripts['test'] = 'playwright test'
    }
  }
  if (features.vitest) {
    pkgJson.devDependencies['@nuxt/test-utils'] = '^3.13.1'
    pkgJson.devDependencies['@testing-library/vue'] = '^8.1.0'
    pkgJson.devDependencies['@vue/test-utils'] = '^2.4.6'
    pkgJson.devDependencies['happy-dom'] = '^14.12.3'
    pkgJson.devDependencies['vitest'] = '^1.6.0'
    if (features.eslint) {
      pkgJson.devDependencies['eslint-plugin-vitest'] = '^0.5.4'
    }

    await addModuleToNuxtConfig(dir, '@nuxt/test-utils')

    if (!features.playwright) {
      pkgJson.scripts['test'] = 'vitest run'
    }
  }
  writePackageJson(dir, pkgJson)
}

async function installProjectDependencies(
  dir: string,
  packageManager: PackageManagerName,
) {
  try {
    await installDependencies({
      cwd: dir,
      packageManager: {
        name: packageManager,
        command: packageManager,
      },
    })
  }
  catch (err) {
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
