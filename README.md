# Nuxt CLI (nuxi)

💫 Next Generation CLI Experience for [Nuxt](https://nuxt.com/).

> **Warning**
> 🚧 This project is heavily a work in progress.

## Open Discussions

- [**Project Goals**](https://github.com/nuxt/cli/discussions/3)
- [Feedbacks and Ideas](https://github.com/nuxt/cli/discussions/4)
- [The journey of Nuxt CLI Generations](https://github.com/nuxt/cli/discussions/7)

## Beta Testing

### Using `npx` (recommended)

```bash
npx nuxi-ng@latest --help
```

### Add to the Project

Install the new CLI dependency:

```bash
# pnpm
pnpm add -D nuxi-ng

# yarn
yarn add -D nuxi-ng

# npm
npm i -D nuxi-ng
```

Change scripts:

```json
{
  "scripts": {
    "dev": "nuxi-ng dev",
    "start": "nuxi-ng start",
    "build": "nuxi-ng build",
    "generate": "nuxi-ng generate"
  }
}
```

## License

[MIT](./LICENSE)
