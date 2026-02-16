# Nuxt CLI (nuxi)

⚡️ [Nuxt](https://nuxt.com/) CLI

## Usage

```bash
$ nuxi [OPTIONS] [COMMAND]

OPTIONS

  --cwd=<directory>    Specify the working directory

COMMANDS

           add    Add Nuxt modules
  add-template    Create a new template file.
       analyze    Build nuxt and analyze production bundle (experimental)
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
     typecheck    Runs `vue-tsc` to check types throughout your app.
       upgrade    Upgrade Nuxt
      complete    Generate shell completion scripts

Use nuxi <command> --help for more information about a command.
```

## Documentation

All commands are documented on https://nuxt.com/docs/api/commands

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
