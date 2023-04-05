# nuxi-ng

💫 Next Generation CLI Experience for [Nuxt](https://nuxt.com/).

### 🌐 Global

Elegant and powerful `nuxt` command accessible immediately from everywhere. To bootstrap, init, develop, extend build and deploy Nuxt project.

### 🧩 Modular

New architucture allows composing CLI sub-commands and features from various sources, making Nuxt CLI as extendable and hackable as Nuxt itself!

### 🤖 Automated

Bootstraping a project, adding a new module or dependency, upgrading Nuxt, changing configuration, creating a template are one command away!

### 💫 Elegant

With better core integration, experience an informative and fancier CLI than ever!

### 🔌 Programmatic

Exposing Programmatic API interface, allows interacting with CLI using Devtools and Web Browser.

### ⚡️ Rapid Development

With independent versioning and self-upgrade support, we can deliver new updates even faster and work on new ideas.

## Usage

### Install Globally (recommended)

```bash
npm i -g nuxi-ng
```

You can now use `nuxt` command to start your projects in development mode:

```bash
nuxt dev
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

MIT
