# Nuxt CLI (nuxi)

⚡️ [Nuxt](https://nuxt.com/) Generation CLI Experience.

## Commands

All commands are listed on https://nuxt.com/docs/api/commands.

## Shell Autocompletions

Nuxi now supports shell autocompletions for `zsh`, `bash`, `fish`, and `powershell`, powered by [`@bomb.sh/tab`](https://github.com/bombshell-dev/tab). 

For permanent setup in zsh, add this to your `~/.zshrc`:

```bash
source <(vitest complete zsh)
# same can be done for other shells
```
For more information, see [bomb.sh/tab](https://bomb.sh/docs/tab/).

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
