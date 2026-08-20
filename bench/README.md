# Benchmarks

Compares a published `@nuxt/cli` against the local `packages/nuxt-cli`.

Measurements are interleaved between both versions. The ratio between the two should be relatively stable, though absolute numbers obviously vary quite a lot.

## Running

```bash
pnpm bench:cli
```

By default this resolves `@nuxt/cli@latest` as the baseline and runs every suite against the `playground` and `large` fixtures. To compare against a specific release:

```bash
pnpm bench:cli --baseline 3.37.0
```

Useful flags:

| Flag | Default | Meaning |
| --- | --- | --- |
| `--baseline` | `latest` | Any npm spec for `@nuxt/cli` to treat as the "before" |
| `--suite` | all | Repeatable. One of `startup`, `modules`, `dev`, `restart`, `build`, `footprint` |
| `--fixture` | `playground`, `large` | Repeatable. Which fixture to run the project-level suites against |
| `--workdir` | `~/.cache/nuxt-cli-bench` | Where isolated installs and fixtures live |
| `--out` | `bench/results/report.md` | Markdown report path. A `.json` sibling is written alongside |
| `--startup-reps` | `15` | Repetitions for the startup suite |
| `--dev-reps` | `5` | Repetitions for the dev-server suite |
| `--restart-reps` | `5` | Repetitions for the restart suite |
| `--build-reps` | `3` | Repetitions for the build suite |
| `--install-reps` | `3` | Repetitions for the install-footprint suite |

For example:

```bash
pnpm bench:cli --suite startup --startup-reps 31
```

## Suites

- **`startup`** - cold `nuxi --version`, `--help`, and unknown-command time. Catches anything pulled onto the module graph of the fast paths.
- **`modules`** - how many modules each target loads for those same commands, via `bench/lib/module-hook.mjs`. A count rather than a time, so it is stable across machines and is the better regression guard of the two.
- **`dev`** - time from spawn to the dev server answering a request.
- **`restart`** - time to serve again after a `nuxt.config.ts` edit, plus a no-op edit case to check that ignored changes stay ignored.
- **`build`** - wall time for `nuxt build`.
- **`footprint`** - installed `node_modules` size, file count, and packed tarball size.

## Comparing two local builds

`bench/run.ts` always measures published-versus-working-tree. To compare two arbitrary builds instead (before and after a patch, say), use the A/B tool, which runs only the startup cases but takes any number of binaries:

```bash
node bench/ab.ts \
  --bin before=/path/to/a/bin/nuxi.mjs \
  --bin after=/path/to/b/bin/nuxi.mjs \
  --case --version --case --help
```
