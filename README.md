# Nuxt CLI (nuxi)

⚡️ [Nuxt](https://nuxt.com/) CLI

## Usage

```bash
$ nuxt [OPTIONS] [COMMAND]

OPTIONS

  --cwd=<directory>    Specify the working directory

COMMANDS

           add    Add Nuxt modules and layers
  add-template    Create a new template file.
       analyze    Build Nuxt and analyze production bundle (experimental)
         build    Build Nuxt for production deployment
       cleanup    Clean up generated Nuxt files and caches
           dev    Run Nuxt development server
      devtools    Enable or disable devtools in a Nuxt project
      generate    Build Nuxt and prerender all routes
          info    Get information about Nuxt project
          init    Initialize a fresh project
        module    Manage Nuxt modules
       prepare    Prepare Nuxt for development/build
       preview    Launches Nitro server for local testing after `nuxi build`.
         start    Launches Nitro server for local testing after `nuxi build`.
          test    Run tests
     typecheck    Runs type-checking throughout your app using `vue-tsc` or Golar.
       upgrade    Upgrade Nuxt
      complete    Generate shell completion scripts

Use nuxi <command> --help for more information about a command.
```

## Documentation

All commands are documented on https://nuxt.com/docs/api/commands

## Adding modules and layers

`nuxt add <name>` installs the package and writes it to `nuxt.config`. Where it is written depends on what the package is:

```bash
# added to `modules`
nuxt add nuxt-shiki

# a layer, added to `extends`
nuxt add nuxt-seo-kit
```

## Update Notifications

Once a day, `nuxt/cli` checks in the background whether a newer version of Nuxt has been released and, if so, prints a short nudge to run `nuxt upgrade` after the command finishes. The `latest` dist-tag is read from the registry configured in your `.npmrc` and cached in your user-level `.nuxtrc`.

To keep the nudge meaningful, it is not shown for prereleases, and not shown for patch releases within the same minor unless you are at least five patches behind.

The check is skipped in CI, on StackBlitz, and when the output is not a terminal. Set `NUXT_IGNORE_UPDATE_CHECK=1` (or `NO_UPDATE_NOTIFIER=1`) to skip a single run, or opt out permanently by adding `updateCheck.enabled=false` to your user-level `.nuxtrc`.

## Shell Autocompletions

`nuxt/cli` provides shell autocompletions for commands, options, and option values &ndash; powered by [`@bomb.sh/tab`](https://github.com/bombshell-dev/tab).

### Package Manager Integration

`@bomb.sh/tab` integrates with [package managers](https://github.com/bombshell-dev/tab?tab=readme-ov-file#package-manager-completions). Autocompletions work when running `nuxt` directly within a Nuxt project:

```bash
pnpm nuxt <Tab>
npm exec nuxt <Tab>
yarn nuxt <Tab>
bun nuxt <Tab>
```

For package manager autocompletions, you should install [tab's package manager completions](https://github.com/bombshell-dev/tab?tab=readme-ov-file#package-manager-completions) separately.

## Contributing

```bash
# Install dependencies
pnpm i

# Build project and start watcher
pnpm dev

# Go to the playground directory
cd playground

# And run any commands
pnpm nuxt <command>
```

## License

[MIT](./LICENSE)
