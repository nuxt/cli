---
title: "nuxt add-template"
description: "Scaffold an entity into your Nuxt application."
links:
  - label: Source
    icon: i-simple-icons-github
    to: https://github.com/nuxt/cli/blob/main/packages/nuxt-cli/src/commands/add-template.ts
    size: xs
---

<!--add-template-cmd-->
```bash [Terminal]
npx nuxt add-template <TEMPLATE> <NAME> [--cwd=<directory>] [--logLevel=<silent|info|verbose>] [--force] [--mode=<client|server>] [--method=<connect|delete|get|head|options|patch|post|put|trace>] [--global] [--api] [--pages] [--client] [--server] [--connect] [--delete] [--get] [--head] [--options] [--post] [--put] [--trace] [--patch]
```
<!--/add-template-cmd-->

The `add-template` command scaffolds a file into the right directory for your project's structure. It replaces `nuxt add <template> <name>`, which still runs but is deprecated.

::read-more{to="/docs/api/commands/add"}
Read more about `nuxt add`, which adds modules and layers to your application.
::

## Arguments

<!--add-template-args-->
| Argument                                                                                                                                                                      | Description                        |
|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------|
| `TEMPLATE=<api\|app\|app-config\|component\|composable\|error\|layer\|layout\|middleware\|module\|page\|plugin\|server-middleware\|server-plugin\|server-route\|server-util>` | Specify which template to generate |
| `NAME`                                                                                                                                                                        | Specify name of the generated file |
<!--/add-template-args-->

## Options

<!--add-template-opts-->
| Option                                                                    | Default | Description                                            |
|---------------------------------------------------------------------------|---------|--------------------------------------------------------|
| `--cwd=<directory>`                                                       | `.`     | Specify the root directory of your Nuxt project        |
| `--logLevel=<silent\|info\|verbose>`                                      |         | Specify build-time log level                           |
| `--force`                                                                 | `false` | Overwrite the file if it already exists                |
| `--mode=<client\|server>`                                                 |         | Add a client or server suffix to a component or plugin |
| `--method=<connect\|delete\|get\|head\|options\|patch\|post\|put\|trace>` |         | Add an HTTP method suffix to an API route              |
| `--global`                                                                |         | Create global route middleware                         |
| `--api`                                                                   |         | Create a server route in the API directory             |
| `--pages`                                                                 |         | Include NuxtPage and NuxtLayout in the app template    |
| `--client`                                                                |         | Shorthand for `--mode client`                          |
| `--server`                                                                |         | Shorthand for `--mode server`                          |
| `--connect`                                                               |         | Shorthand for `--method connect`                       |
| `--delete`                                                                |         | Shorthand for `--method delete`                        |
| `--get`                                                                   |         | Shorthand for `--method get`                           |
| `--head`                                                                  |         | Shorthand for `--method head`                          |
| `--options`                                                               |         | Shorthand for `--method options`                       |
| `--post`                                                                  |         | Shorthand for `--method post`                          |
| `--put`                                                                   |         | Shorthand for `--method put`                           |
| `--trace`                                                                 |         | Shorthand for `--method trace`                         |
| `--patch`                                                                 |         | Shorthand for `--method patch`                         |
<!--/add-template-opts-->

**Modifiers:**

Some templates take an extra flag that adds a suffix (like `.client` or `.get`) to the generated file name. Each value `--mode` and `--method` accept is also a flag of its own, so `--mode client` and `--client` do the same thing.

Files are written relative to your [`srcDir`](/docs/api/nuxt-config#srcdir), which defaults to `app/`, and server files relative to your [`serverDir`](/docs/api/nuxt-config#serverdir). The paths below assume those defaults.

```bash [Terminal]
# Generates `app/plugins/sockets.client.ts`
npx nuxt add-template plugin sockets --mode client
```

## `nuxt add-template component`

* Modifier flags: `--mode`, or `--client` / `--server`

```bash [Terminal]
# Generates `app/components/TheHeader.vue`
npx nuxt add-template component TheHeader
```

## `nuxt add-template composable`

```bash [Terminal]
# Generates `app/composables/foo.ts`
npx nuxt add-template composable foo
```

## `nuxt add-template layout`

```bash [Terminal]
# Generates `app/layouts/custom.vue`
npx nuxt add-template layout custom
```

## `nuxt add-template plugin`

* Modifier flags: `--mode`, or `--client` / `--server`

```bash [Terminal]
# Generates `app/plugins/analytics.ts`
npx nuxt add-template plugin analytics
```

## `nuxt add-template page`

```bash [Terminal]
# Generates `app/pages/about.vue`
npx nuxt add-template page about
```

```bash [Terminal]
# Generates `app/pages/category/[id].vue`
npx nuxt add-template page "category/[id]"
```

## `nuxt add-template middleware`

* Modifier flags: `--global`

```bash [Terminal]
# Generates `app/middleware/auth.ts`
npx nuxt add-template middleware auth
```

## `nuxt add-template api`

* Modifier flags: `--method`, or the method as a flag of its own (`--get`, `--post`, and so on)

```bash [Terminal]
# Generates `server/api/hello.ts`
npx nuxt add-template api hello
```

## `nuxt add-template server-route`

* Modifier flags: `--api` to write the route under `server/api` instead of `server/routes`

```bash [Terminal]
# Generates `server/routes/webhook.ts`
npx nuxt add-template server-route webhook
```

## `nuxt add-template layer`

```bash [Terminal]
# Generates `layers/subscribe/nuxt.config.ts`
npx nuxt add-template layer subscribe
```

::note
A name that would resolve outside the project is refused, so pass a path relative to the project without leading slashes or `..` segments.
::
