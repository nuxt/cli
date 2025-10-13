# Nuxt CLI (nuxi)

⚡️ [Nuxt](https://nuxt.com/) Generation CLI Experience.

## Commands

All commands are listed on https://nuxt.com/docs/api/commands.

## Shell Autocompletions

Nuxi provides shell autocompletions for commands, options, and option values powered by [`@bomb.sh/tab`](https://github.com/bombshell-dev/tab).

### Setup

For permanent setup in zsh, add this to your `~/.zshrc`:

```bash
# Add to ~/.zshrc for permanent autocompletions (same can be done for other shells)
source <(nuxi complete zsh)
```

### Package Manager Integration

`@bomb.sh/tab` integrates with [package managers](https://github.com/bombshell-dev/tab?tab=readme-ov-file#package-manager-completions). Autocompletions work when running nuxi directly:

```bash
npx nuxi <Tab>
npm exec nuxi <Tab>
pnpm nuxi <Tab>
yarn nuxi <Tab>
bun nuxi <Tab>
```

For package manager autocompletions, you should install [tab's package manager completions](https://github.com/bombshell-dev/tab?tab=readme-ov-file#package-manager-completions) separately.

## Contributing

```bash
# Install dependencies
pnpm i

# Generate type stubs
pnpm dev:prepare

# Go to the playground directory
cd playground

# And run any commands
pnpm nuxi <command>
```

## License

[MIT](./LICENSE)
