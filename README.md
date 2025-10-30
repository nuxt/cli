# Nuxt CLI (nuxi)

⚡️ [Nuxt](https://nuxt.com/) Generation CLI Experience.

## Commands

All commands are listed on https://nuxt.com/docs/api/commands.

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
