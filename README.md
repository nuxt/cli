# Nuxt CLI (nuxi)

⚡️ Next Generation CLI Experience for [Nuxt](https://nuxt.com/).

> **Warning**
> This project is heavily a work in progress.


## Open Discussions

- <a href="https://github.com/nuxt/cli/discussions/3" target="_blank"><strong>Project Goals</strong></a>
- <a href="https://github.com/nuxt/cli/discussions/4" target="_blank">Feedbacks and Ideas</a>
- <a href="https://github.com/nuxt/cli/discussions/7" target="_blank">The journey of Nuxt CLI Generations</a>


## Beta Testing

### Using `npx`

```bash
npx nuxi-ng@latest --help
```

### Global Install

```bash
npm i -g nuxi-ng@latest
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
