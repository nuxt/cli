---
title: "nuxt docs"
description: The docs command searches the Nuxt documentation for the version your project uses.
links:
  - label: Source
    icon: i-simple-icons-github
    to: https://github.com/nuxt/cli/blob/main/packages/nuxt-cli/src/commands/docs.ts
    size: xs
---

<!--docs-cmd-->
```bash [Terminal]
npx nuxt docs [QUERY] [--cwd=<directory>] [--open]
```
<!--/docs-cmd-->

The `docs` command searches the Nuxt documentation and opens the best match in your browser. Without a query it opens the documentation home page.

## Arguments

<!--docs-args-->
| Argument | Description                           |
|----------|---------------------------------------|
| `QUERY`  | Words to search the documentation for |
<!--/docs-args-->

## Options

<!--docs-opts-->
| Option              | Default | Description                                        |
|---------------------|---------|----------------------------------------------------|
| `--cwd=<directory>` | `.`     | Specify the root directory of your Nuxt project    |
| `--open`            | `true`  | Open the best match in a browser                   |
| `--no-open`         |         | Print the matching pages without opening a browser |
<!--/docs-opts-->

Results are ranked by page title, then by section heading, then by description, and the matches are printed before the best one is opened. When several pages match and the terminal is interactive, you are asked which one to open.

```bash [Terminal]
npx nuxt docs "server routes"
```

The search runs against the documentation for the Nuxt version the project depends on rather than whatever is currently published, so the answers match the version you are using. `@nuxt/docs` is used when it is installed in the project, and downloaded otherwise.
