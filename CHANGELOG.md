# Changelog


## v3.17.2

[compare changes](https://github.com/nuxt/cli/compare/v3.17.1...v3.17.2)

### 🩹 Fixes

- **dev:** Chain `catch` correctly on promise ([4504a4c](https://github.com/nuxt/cli/commit/4504a4c))

### 🏡 Chore

- Lint ([1831710](https://github.com/nuxt/cli/commit/1831710))

### ❤️ Contributors

- Daniel Roe ([@danielroe](http://github.com/danielroe))

## v3.17.1

[compare changes](https://github.com/nuxt/cli/compare/v3.17.0...v3.17.1)

### 🩹 Fixes

- **module:** Pass resolved `cwd` to `addDependency` ([#606](https://github.com/nuxt/cli/pull/606))

### ❤️ Contributors

- Daniel Roe ([@danielroe](http://github.com/danielroe))

## v3.17.0

[compare changes](https://github.com/nuxt/cli/compare/v3.16.0...v3.17.0)

### 🚀 Enhancements

- **module:** Add multiple modules at once ([#584](https://github.com/nuxt/cli/pull/584))

### 🩹 Fixes

- **analyze:** Show readable chunk names ([#587](https://github.com/nuxt/cli/pull/587))
- **add:** Respect custom dirs from nuxt project ([#586](https://github.com/nuxt/cli/pull/586))
- **cleanup:** Remove dev `buildDir` when cleaning up ([#590](https://github.com/nuxt/cli/pull/590))
- **analyze:** Support `--dotenv` argument ([#589](https://github.com/nuxt/cli/pull/589))
- **dev:** Use `SIGTERM` instead of `SIGHUP` on windows ([#603](https://github.com/nuxt/cli/pull/603))
- **dev:** Restart nuxt if unhandled rejection occurs ([#602](https://github.com/nuxt/cli/pull/602))

### 💅 Refactors

- Share command descriptions and `--cwd` default ([#592](https://github.com/nuxt/cli/pull/592))

### ❤️ Contributors

- Bobbie Goede <bobbiegoede@gmail.com>
- Daniel Roe ([@danielroe](http://github.com/danielroe))

## v3.16.0

[compare changes](https://github.com/nuxt/cli/compare/v3.15.0...v3.16.0)

### 🚀 Enhancements

- **init:** Add support for `deno` ([#526](https://github.com/nuxt/cli/pull/526))

### 🩹 Fixes

- **dev:** Handle non-existent dev server on restart ([#560](https://github.com/nuxt/cli/pull/560))
- **module:** Pass registry auth token when fetching metadata ([#537](https://github.com/nuxt/cli/pull/537))
- Improved internal type safety ([9ad7d6f](https://github.com/nuxt/cli/commit/9ad7d6f))

### 🏡 Chore

- Revert change to playground `package.json` ([45801c0](https://github.com/nuxt/cli/commit/45801c0))

### ❤️ Contributors

- Daniel Roe ([@danielroe](http://github.com/danielroe))
- Thomas Kjærgaard ([@tkjaergaard](http://github.com/tkjaergaard))
- Adrien Foulon ([@Tofandel](http://github.com/Tofandel))
- Yasser Lahbibi ([@yassilah](http://github.com/yassilah))

## v3.15.0

[compare changes](https://github.com/nuxt/cli/compare/v3.14.0...v3.15.0)

### 🚀 Enhancements

- Add `--env-name` flag for configuration overrides ([#357](https://github.com/nuxt/cli/pull/357), [#424](https://github.com/nuxt/cli/pull/424))
- **upgrade:** Allow upgrading to nightly release channel ([#465](https://github.com/nuxt/cli/pull/465))
- **module:** Rerun prepare command after installing module ([61f0172](https://github.com/nuxt/cli/commit/61f0172))

### 🩹 Fixes

- **add:** Don't add extra `/` if joining registry + package ([b462713](https://github.com/nuxt/cli/commit/b462713))
- **dev:** Respect explicit address and port in `--inspect` ([#508](https://github.com/nuxt/cli/pull/508))
- **info:** Await loading of nuxt config file ([#528](https://github.com/nuxt/cli/pull/528))
- **build:** Respect environment variable preset overrides ([#514](https://github.com/nuxt/cli/pull/514))
- **module:** Respect per-scope registry when installing packages ([#510](https://github.com/nuxt/cli/pull/510), [#519](https://github.com/nuxt/cli/pull/519))
- **typecheck:** Use `bunx` if running on bun ([#494](https://github.com/nuxt/cli/pull/494))
- **add:** Handle kebab-case composable names ([#522](https://github.com/nuxt/cli/pull/522))
- **upgrade:** Include other core nuxt packages in upgrade ([40877ae](https://github.com/nuxt/cli/commit/40877ae))
- **upgrade:** Avoid printing info when versions are unknown ([019a6f8](https://github.com/nuxt/cli/commit/019a6f8))
- **upgrade:** Handle aborted nightly channel selection ([c263859](https://github.com/nuxt/cli/commit/c263859))
- **preview:** Show more accurate message with custom `--dotenv` ([3fe1ff9](https://github.com/nuxt/cli/commit/3fe1ff9))

### 💅 Refactors

- **upgrade:** Move channel prompt before lockfile prompt ([b3f31de](https://github.com/nuxt/cli/commit/b3f31de))

### 🏡 Chore

- Add CODEOWNERS file ([95ec3c8](https://github.com/nuxt/cli/commit/95ec3c8))

### 🤖 CI

- Run test suite on windows ([#512](https://github.com/nuxt/cli/pull/512))

### ❤️ Contributors

- Daniel Roe ([@danielroe](http://github.com/danielroe))
- Martin ([@martin-mastermind](http://github.com/martin-mastermind))
- Teena ([@franklin-tina](http://github.com/franklin-tina))
- Horu ([@HigherOrderLogic](http://github.com/HigherOrderLogic))
- Thomas Kjærgaard ([@tkjaergaard](http://github.com/tkjaergaard))
- Ezra Ashenafi ([@Eazash](http://github.com/Eazash))
- Selemon Brahanu ([@selemondev](http://github.com/selemondev))
- Till Sanders ([@tillsanders](http://github.com/tillsanders))
- Giacomo Trezzi <giacomo.trezzi@gmail.com>

## v3.14.0

[compare changes](https://github.com/nuxt/cli/compare/v3.13.2...v3.14.0)

### 🚀 Enhancements

- **info:** Use jiti v2 ([#477](https://github.com/nuxt/cli/pull/477))
- **module:** Respect package registry set in `.npmrc` ([#470](https://github.com/nuxt/cli/pull/470))

### 🔥 Performance

- Remove `fsevents` as optional dependency ([f9714f2](https://github.com/nuxt/cli/commit/f9714f2))

### 🩹 Fixes

- Resolve `nuxt` directory from `rootDir` ([1518e46](https://github.com/nuxt/cli/commit/1518e46))

### ❤️ Contributors

- Daniel Roe ([@danielroe](http://github.com/danielroe))
- Kiameow ([@Kiameow](http://github.com/Kiameow))

## v3.13.2

[compare changes](https://github.com/nuxt/cli/compare/v3.13.1...v3.13.2)

### 🩹 Fixes

- **dev:** Handle relative baseURL ([#468](https://github.com/nuxt/cli/pull/468))

### 🏡 Chore

- **release:** V3.13.1 ([34bdbbc](https://github.com/nuxt/cli/commit/34bdbbc))
- Add `compatibilityDate` ([dd0bf06](https://github.com/nuxt/cli/commit/dd0bf06))

### ❤️ Contributors

- Daniel Roe ([@danielroe](http://github.com/danielroe))

## v3.13.1

[compare changes](https://github.com/nuxt/cli/compare/v3.13.0...v3.13.1)

## v3.13.0

[compare changes](https://github.com/nuxt/cli/compare/v3.12.0...v3.13.0)

### 🚀 Enhancements

- **build:** Warn if `--prerender` overrides `--preset` ([#392](https://github.com/nuxt/cli/pull/392))
- **module:** Support other nuxt config extensions when adding ([#401](https://github.com/nuxt/cli/pull/401))
- **module:** Install module peer dependencies ([#442](https://github.com/nuxt/cli/pull/442))
- **info:** Link to issue templates ([#406](https://github.com/nuxt/cli/pull/406))

### 🩹 Fixes

- Allow configuring vite hmr protocol ([#436](https://github.com/nuxt/cli/pull/436))
- Add `-w` arg when updating pnpm root workspace ([#449](https://github.com/nuxt/cli/pull/449))
- Keep nuxt current dependency type ([#430](https://github.com/nuxt/cli/pull/430))

### 💅 Refactors

- **module:** Use `c12` util to update config ([#441](https://github.com/nuxt/cli/pull/441))

### 🏡 Chore

- Remove `is-number` from bundled cli ([#439](https://github.com/nuxt/cli/pull/439))
- Remove unnecessary spread operator and fix typos ([#459](https://github.com/nuxt/cli/pull/459))

### ❤️ Contributors

- OrbisK ([@OrbisK](http://github.com/OrbisK))
- Deth <gabriel@rosa.dev.br>
- Julien Huang ([@huang-julien](http://github.com/huang-julien))
- Xjccc ([@xjccc](http://github.com/xjccc))
- Daniel Roe ([@danielroe](http://github.com/danielroe))
- Meir Roth ([@meirroth](http://github.com/meirroth))
- Cmd430 <cmd430@gmail.com>

## v3.12.0

[compare changes](https://github.com/nuxt/cli/compare/v3.11.1...v3.12.0)

### 🩹 Fixes

- **prepare:** Respect `--dotenv` ([#377](https://github.com/nuxt/cli/pull/377))
- Add '@nuxt/kit' to nuxt module verification ([#386](https://github.com/nuxt/cli/pull/386), [#387](https://github.com/nuxt/cli/pull/387))
- Check`nitropack-nightly` when resolving nitro version ([bfaf128](https://github.com/nuxt/cli/commit/bfaf128))
- **dev:** Set `hmr.server` earlier in lifecycle ([#420](https://github.com/nuxt/cli/pull/420))
- **preview:** Correct path with custom `nitro.output.dir` ([#376](https://github.com/nuxt/cli/pull/376))

### 🏡 Chore

- **release:** V3.11.1 ([8e1bd03](https://github.com/nuxt/cli/commit/8e1bd03))
- Migrate to eslint v9 ([#412](https://github.com/nuxt/cli/pull/412))
- **add:** Change order of `setup` attr in templates ([#378](https://github.com/nuxt/cli/pull/378))

### ❤️ Contributors

- Xjccc ([@xjccc](http://github.com/xjccc))
- Daniel Roe ([@danielroe](http://github.com/danielroe))
- Dale Weaver ([@daleweaver777](http://github.com/daleweaver777))
- 你好怪凡 <zousitanghulu@foxmail.com>
- Damian Głowala ([@DamianGlowala](http://github.com/DamianGlowala))
- Pooya Parsa ([@pi0](http://github.com/pi0))

## v3.11.1

[compare changes](https://github.com/nuxt/cli/compare/v3.11.0...v3.11.1)

### 🩹 Fixes

- **dev:** Prepend `baseURL` for vite hmr ws upgrade ([#370](https://github.com/nuxt/cli/pull/370))

### 🏡 Chore

- Update lockfile ([ec0bc08](https://github.com/nuxt/cli/commit/ec0bc08))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))
- Anthony Fu <anthonyfu117@hotmail.com>

## v3.11.0

[compare changes](https://github.com/nuxt/cli/compare/v3.10.1...v3.11.0)

### 🚀 Enhancements

- **dev:** Support experimental runtime websocket ([#348](https://github.com/nuxt/cli/pull/348))
- Support module aliases and validate cwd and pkg ([#362](https://github.com/nuxt/cli/pull/362))
- **module search:** Add stats to module search results ([#221](https://github.com/nuxt/cli/pull/221))

### 🩹 Fixes

- **typecheck:** Use resolve `vue-tsc` and `typescript`  path ([#264](https://github.com/nuxt/cli/pull/264))

### 💅 Refactors

- **module:** Improve messages ([#355](https://github.com/nuxt/cli/pull/355))
- **pkg:** Update node engine ([#356](https://github.com/nuxt/cli/pull/356))
- Migrate to `cwd` from `rootDir` ([#350](https://github.com/nuxt/cli/pull/350))
- **add:** Strip `.ts` and `.vue` extension from name ([#345](https://github.com/nuxt/cli/pull/345))

### 📖 Documentation

- Update commands link ([54726df](https://github.com/nuxt/cli/commit/54726df))

### 🏡 Chore

- **release:** V3.10.1 ([5de9b7c](https://github.com/nuxt/cli/commit/5de9b7c))
- Correct grammar ([2f9762a](https://github.com/nuxt/cli/commit/2f9762a))
- Update lockfile ([ea58b08](https://github.com/nuxt/cli/commit/ea58b08))

### ❤️ Contributors

- Jonas Thelemann <e-mail@jonas-thelemann.de>
- Pooya Parsa ([@pi0](http://github.com/pi0))
- Gangan ([@shinGangan](http://github.com/shinGangan))
- Richard Rohrig ([@rohrig](http://github.com/rohrig))
- Ethan ([@yuusheng](http://github.com/yuusheng))
- Sébastien Chopin ([@Atinux](http://github.com/Atinux))
- Damian Głowala ([@DamianGlowala](http://github.com/DamianGlowala))

## v3.10.1

[compare changes](https://github.com/nuxt/cli/compare/v3.10.0...v3.10.1)

### 🩹 Fixes

- Don't write `.npmrc` with `shamefully-hoist=true` anymore ([#319](https://github.com/nuxt/cli/pull/319))
- Handle spaces in path at repo initialization ([#300](https://github.com/nuxt/cli/pull/300))
- **dev:** Support `.config/` dir and custom config extensions ([#341](https://github.com/nuxt/cli/pull/341))

### 💅 Refactors

- **add:** Show description for `template` positional arg ([#325](https://github.com/nuxt/cli/pull/325))

### 🏡 Chore

- Update giget to 1.2 and lockfile ([#159](https://github.com/nuxt/cli/pull/159))
- Remove unused imports ([9ca7ae4](https://github.com/nuxt/cli/commit/9ca7ae4))
- Update dependencies ([9995400](https://github.com/nuxt/cli/commit/9995400))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))
- Ettapp 
- Gangan 
- Daniel Roe ([@danielroe](http://github.com/danielroe))
- Celibioux

## v3.10.0

[compare changes](https://github.com/nuxt/cli/compare/v3.9.1...v3.10.0)

### 🚀 Enhancements

- **build:** Support `--preset` arg ([#290](https://github.com/nuxt/cli/pull/290))
- **dev:** Return listener instance for programmatic usage ([#278](https://github.com/nuxt/cli/pull/278))

### 🩹 Fixes

- **analyze:** Don't override analyze options ([#259](https://github.com/nuxt/cli/pull/259))
- **init:** Use absolute path for installing dependencies ([#272](https://github.com/nuxt/cli/pull/272))
- **dev:** Pass programmatic args to sub process ([#275](https://github.com/nuxt/cli/pull/275))
- **analyze, cleanup, upgrade:** Respect custom `buildDir` ([#276](https://github.com/nuxt/cli/pull/276))
- **analyze:** Set path for client analyze results ([#277](https://github.com/nuxt/cli/pull/277))
- **test:** Pass `rootDir` to `runTests` command ([#284](https://github.com/nuxt/cli/pull/284))

### 💅 Refactors

- Use magicast `.includes` helper ([#268](https://github.com/nuxt/cli/pull/268))
- **upgrade:** Improve error message when package manager cannot be detected ([#270](https://github.com/nuxt/cli/pull/270))

### 🏡 Chore

- **release:** V3.9.1 ([25c3dfe](https://github.com/nuxt/cli/commit/25c3dfe))
- Update citty and lockfile ([2104cf8](https://github.com/nuxt/cli/commit/2104cf8))
- Update lockfile ([7515e22](https://github.com/nuxt/cli/commit/7515e22))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))
- Katerina Skroumpelou 
- Daniel Roe <daniel@roe.dev>
- Larry Williamson ([@L422Y](http://github.com/L422Y))
- Jiten (Jits) Bhagat 
- Angel Hernandez <angel.hernandez.12@live.com>

## v3.9.1

[compare changes](https://github.com/nuxt/cli/compare/v3.9.0...v3.9.1)

### 🩹 Fixes

- Pass `baseUrl` to listen options ([#236](https://github.com/nuxt/cli/pull/236))
- **dev:** Prefer `localhost` over `[::]` for internal networking ([#242](https://github.com/nuxt/cli/pull/242))
- Support `-nightly` nuxt releases and publish `nuxi-nightly` ([#248](https://github.com/nuxt/cli/pull/248))

### 🏡 Chore

- **release:** V3.9.0 ([c4b90f7](https://github.com/nuxt/cli/commit/c4b90f7))
- Add `.devcontainer` ([b8f9fd3](https://github.com/nuxt/cli/commit/b8f9fd3))
- Islolate `dist` dir for dev container ([f55d0a1](https://github.com/nuxt/cli/commit/f55d0a1))
- Update c12 and lockfile ([f7eecc7](https://github.com/nuxt/cli/commit/f7eecc7))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))
- Daniel Roe <daniel@roe.dev>
- Warflash <nwiesinger67@gmail.com>

## v3.9.0

[compare changes](https://github.com/nuxt/cli/compare/v3.8.4...v3.9.0)

### 🚀 Enhancements

- **dev:** Reuse main dev port for vite hmr ([#184](https://github.com/nuxt/cli/pull/184))
- **mod-search:** Filter mod search by compatible nuxt version ([#134](https://github.com/nuxt/cli/pull/134))
- **init:** Support `--package-manager` ([#97](https://github.com/nuxt/cli/pull/97))
- Modules db integration with `nuxi module add` ([#197](https://github.com/nuxt/cli/pull/197))
- **init:** Support `--git-init` ([#204](https://github.com/nuxt/cli/pull/204))

### 🔥 Performance

- **dev:** Avoid using proxy with `--no-fork` mode ([#207](https://github.com/nuxt/cli/pull/207))

### 🩹 Fixes

- Use `hook` to avoid rece conditions ([bc98376](https://github.com/nuxt/cli/commit/bc98376))
- Soft warning for `node < 18` ([#199](https://github.com/nuxt/cli/pull/199))
- Make dev proxy url available for `listen` hook ([#206](https://github.com/nuxt/cli/pull/206))
- Use internal dev server url for dev proxy ([1316da6](https://github.com/nuxt/cli/commit/1316da6))
- **dev:** Remove duplicate url in no-fork mode ([dfb3651](https://github.com/nuxt/cli/commit/dfb3651))
- Prompt to abort `module add` if install failed ([#208](https://github.com/nuxt/cli/pull/208))

### 💅 Refactors

- Remove unused dependencies and code ([f0e0c94](https://github.com/nuxt/cli/commit/f0e0c94))

### 🏡 Chore

- **release:** V3.8.4 ([5e97bc2](https://github.com/nuxt/cli/commit/5e97bc2))
- Add `dev:bun` and `nuxi-bun` local scripts ([e350838](https://github.com/nuxt/cli/commit/e350838))
- Allow disabling vite hmr port integration ([#189](https://github.com/nuxt/cli/pull/189))
- Update listhen ([9de6d4c](https://github.com/nuxt/cli/commit/9de6d4c))
- Update listhen ([8039b88](https://github.com/nuxt/cli/commit/8039b88))
- Update lockfile ([43bbe9b](https://github.com/nuxt/cli/commit/43bbe9b))
- Update listhen ([f831d51](https://github.com/nuxt/cli/commit/f831d51))
- Update listhen and lockfile ([68ba094](https://github.com/nuxt/cli/commit/68ba094))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))
- Richard Rohrig 
- Murisceman <murisceman@gmail.com>

## v3.8.4

[compare changes](https://github.com/nuxt/cli/compare/v3.8.3...v3.8.4)

### 🩹 Fixes

- Pass `logLevel` when running `prepare` ([#170](https://github.com/nuxt/cli/pull/170))
- Allow layers to define `devServer` config ([#166](https://github.com/nuxt/cli/pull/166))
- **dev:** Use dedicated signal for restart ([#174](https://github.com/nuxt/cli/pull/174))
- **dev:** Default host should be undefined ([#182](https://github.com/nuxt/cli/pull/182))

### 🏡 Chore

- Update `listhen` and `nuxt` ([6c21be3](https://github.com/nuxt/cli/commit/6c21be3))
- Cleanup ws playground ([701e38f](https://github.com/nuxt/cli/commit/701e38f))
- Update dependencies ([9d6bcb6](https://github.com/nuxt/cli/commit/9d6bcb6))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))
- Niels Janssen <nielsjanssen@live.nl>
- Daniel Roe <daniel@roe.dev>

## v3.8.3

[compare changes](https://github.com/nuxt/cli/compare/v3.8.2...v3.8.3)

### 🩹 Fixes

- Allow overriding internal dev server error via `_PORT` ([#165](https://github.com/nuxt/cli/pull/165))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))

## v3.8.2

[compare changes](https://github.com/nuxt/cli/compare/v3.8.1...v3.8.2)

### 🏡 Chore

- Update nypm ([adfaf8b](https://github.com/nuxt/cli/commit/adfaf8b))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))

## v3.8.1

[compare changes](https://github.com/nuxt/cli/compare/v3.8.0...v3.8.1)

### 🩹 Fixes

- **dev:** Add polyfill for `writeTypes` ([#158](https://github.com/nuxt/cli/pull/158))

### 🏡 Chore

- Update dependencies ([4dee2dc](https://github.com/nuxt/cli/commit/4dee2dc))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))

## v3.8.0

[compare changes](https://github.com/nuxt/cli/compare/v3.7.3...v3.8.0)

### 🚀 Enhancements

- Add `--sourcemap` support to `build-module` ([#129](https://github.com/nuxt/cli/pull/129))

### 🩹 Fixes

- Update listhen ([86cfa41](https://github.com/nuxt/cli/commit/86cfa41))
- **dev:** Enable `https` by default when `devServer.https` options is set ([#146](https://github.com/nuxt/cli/pull/146))
- **dev:** Handle hard restart ([#147](https://github.com/nuxt/cli/pull/147))
- **dev:** Provide cli entry for programmatic usage ([#148](https://github.com/nuxt/cli/pull/148))
- **dev:** Disable forked mode by default for bun and test ([#154](https://github.com/nuxt/cli/pull/154))

### 💅 Refactors

- Import `package.json` with json assertion ([#151](https://github.com/nuxt/cli/pull/151))
- **dev:** Rewrite dev to support `--no-fork` and improve stability ([#153](https://github.com/nuxt/cli/pull/153))

### 🏡 Chore

- Update lockfile ([97d313f](https://github.com/nuxt/cli/commit/97d313f))
- Update lockfile for `get-port-please` ([41a1b75](https://github.com/nuxt/cli/commit/41a1b75))
- Remove `console.log` ([9c851ce](https://github.com/nuxt/cli/commit/9c851ce))
- Update jiti ([942b5c7](https://github.com/nuxt/cli/commit/942b5c7))
- Update nitro to 2.6.3 ([41824a7](https://github.com/nuxt/cli/commit/41824a7))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))
- Bobbie Goede <bobbiegoede@gmail.com>

## v3.7.3

[compare changes](https://github.com/nuxt/cli/compare/v3.7.1...v3.7.3)

### 🩹 Fixes

- Update nypm to 0.3.2 ([#116](https://github.com/nuxt/cli/pull/116))
- **dev:** Pass listener interface to the `listen` hook ([#120](https://github.com/nuxt/cli/pull/120))
- **devtools:** Define `enable ([disable` command as positional argument (#119)](https://github.com/nuxt/cli/commit/disable` command as positional argument (#119)))
- Prefer ipv4 stack for windows, wsl2 and internals ([#122](https://github.com/nuxt/cli/pull/122))
- Add cli version and name in usage ([#123](https://github.com/nuxt/cli/pull/123))
- Improve preview banner and add backward compatible `start` ([#124](https://github.com/nuxt/cli/pull/124))
- **dev:** Use truthy value of `-o` ([#125](https://github.com/nuxt/cli/pull/125))
- **dev:** Pass `https` info to the vite hmr ([#126](https://github.com/nuxt/cli/pull/126))
- **dev:** Support ws upgrades ([#127](https://github.com/nuxt/cli/pull/127))

### 💅 Refactors

- **upgrade:** Prompt for force install ([#111](https://github.com/nuxt/cli/pull/111))

### 📖 Documentation

- Fix typo ([#110](https://github.com/nuxt/cli/pull/110))

### 🏡 Chore

- **release:** V3.7.2 ([ebc8ece](https://github.com/nuxt/cli/commit/ebc8ece))
- Fix typo ([f7e71ec](https://github.com/nuxt/cli/commit/f7e71ec))
- Add `packageManager` field to the playground ([0d9b4e8](https://github.com/nuxt/cli/commit/0d9b4e8))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))
- 1ab4c49 <Andrey Yolkin>
- Daniel Roe <daniel@roe.dev>

## v3.7.2

[compare changes](https://github.com/nuxt/cli/compare/v3.7.0...v3.7.2)

### 🩹 Fixes

- Update name internally to `nuxi` ([42106c6](https://github.com/nuxt/cli/commit/42106c6))
- Respect `HOST`, `--host` and `devServer.host` options ([#105](https://github.com/nuxt/cli/pull/105))
- **dev:** Add backward compatibility for `-o` and `-p` and deprecate `ssl*` args ([#106](https://github.com/nuxt/cli/pull/106))

### 🏡 Chore

- **release:** V3.7.0 ([40d98cb](https://github.com/nuxt/cli/commit/40d98cb))
- Publish as nuxi ([d655b4e](https://github.com/nuxt/cli/commit/d655b4e))
- Add `.eslintignore` ([3cd3b49](https://github.com/nuxt/cli/commit/3cd3b49))
- Update dependencies ([9379f78](https://github.com/nuxt/cli/commit/9379f78))
- Update dependencies ([5633db6](https://github.com/nuxt/cli/commit/5633db6))

### 🤖 CI

- Publish canary as `nuxi-edge` (for now) ([d1120b1](https://github.com/nuxt/cli/commit/d1120b1))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))
- Daniel Roe <daniel@roe.dev>

## v3.7.0


### 🚀 Enhancements

- **cli:** `nuxi info` ([#503](https://github.com/nuxt/cli/pull/503))
- Use native esm for all packages ([#539](https://github.com/nuxt/cli/pull/539))
- **nuxi:** Basic `nuxi init` ([#659](https://github.com/nuxt/cli/pull/659))
- **nuxi:** Invoke `prepare` step for nuxi dev/build ([#689](https://github.com/nuxt/cli/pull/689))
- **cli:** Add placeholder generate command ([#738](https://github.com/nuxt/cli/pull/738))
- **cli:** Generate tsconfig.json in prepare command ([#822](https://github.com/nuxt/cli/pull/822))
- **nuxi:** Support `--host`, `--ssl-cert`, and `--ssl-key` args ([#993](https://github.com/nuxt/cli/pull/993))
- ⚠️  Add `engines.node` field and node.js version check ([#1197](https://github.com/nuxt/cli/pull/1197))
- Auto-import for composables ([#1176](https://github.com/nuxt/cli/pull/1176))
- **nuxi:** Bundle analyzer ([#701](https://github.com/nuxt/cli/pull/701))
- Define nitro `#storage` and `#assets` types ([#1377](https://github.com/nuxt/cli/pull/1377))
- **nuxi:** Nuxi upgrade command ([#1468](https://github.com/nuxt/cli/pull/1468))
- **nuxi:** Support pnpm for nuxi upgrade ([#1516](https://github.com/nuxt/cli/pull/1516))
- `typescript` options ([#1940](https://github.com/nuxt/cli/pull/1940))
- **nuxi:** Add `typecheck` command using `vue-tsc` ([#2132](https://github.com/nuxt/cli/pull/2132))
- **deps:** Update all non-major dependencies ([#2252](https://github.com/nuxt/cli/pull/2252))
- **nuxi:** Add `nuxi preview` command for local testing ([#2162](https://github.com/nuxt/cli/pull/2162))
- **nuxi:** Use nuxt/starter by default for templates ([5c94df645](https://github.com/nuxt/cli/commit/5c94df645))
- **nuxi:** Call nuxt `listen` hook for dev ([#2772](https://github.com/nuxt/cli/pull/2772))
- **nuxi:** Clear cache on upgrade ([#2936](https://github.com/nuxt/cli/pull/2936))
- Shared logger and silent test logs ([#3259](https://github.com/nuxt/cli/pull/3259))
- `.nuxtignore` support and `isIgnored` kit utility ([#3424](https://github.com/nuxt/cli/pull/3424))
- **nuxi:** Add jsx option to generated tsconfig ([#3449](https://github.com/nuxt/cli/pull/3449))
- **nitro, nuxt3:** Allow handling otherwise unhandled runtime errors ([#3464](https://github.com/nuxt/cli/pull/3464))
- **nuxi:** Init `nuxi test` support ([#3307](https://github.com/nuxt/cli/pull/3307))
- **nuxi:** Expose `runCommand` ([#3749](https://github.com/nuxt/cli/pull/3749))
- **test-utils:** Test in development mode ([#3753](https://github.com/nuxt/cli/pull/3753))
- Support reactivity transform ([#3737](https://github.com/nuxt/cli/pull/3737))
- **nuxi:** Scaffold files with `nuxi add` ([#3841](https://github.com/nuxt/cli/pull/3841))
- **nuxi:** Load `.env` when previewing builds ([#4016](https://github.com/nuxt/cli/pull/4016))
- ⚠️  Migrate to nitropack ([#3956](https://github.com/nuxt/cli/pull/3956))
- **nuxi:** `nuxi cleanup` command ([#6125](https://github.com/nuxt/cli/pull/6125))
- **nuxi:** Auto cleanup with project manifest changes ([#6672](https://github.com/nuxt/cli/pull/6672))
- **nuxt:** `app.config` with hmr and reactivity support ([#6333](https://github.com/nuxt/cli/pull/6333))
- **nuxi:** Support mode flags for `add` command ([#3921](https://github.com/nuxt/cli/pull/3921))
- **nuxi:** Display nuxt and nitro versions for dev and build commands ([#7118](https://github.com/nuxt/cli/pull/7118))
- Allow extending with `theme` config ([#7131](https://github.com/nuxt/cli/pull/7131))
- **nuxi:** Switch to `unjs/giget` for `nuxi init` ([#7361](https://github.com/nuxt/cli/pull/7361))
- **cli:** ⚠️  Use giget 0.1x with template registry for `nuxi init` ([#7404](https://github.com/nuxt/cli/pull/7404))
- **nuxi:** Support `--dotenv` for `dev`, `build` and `preview` commands ([#7660](https://github.com/nuxt/cli/pull/7660))
- ⚠️  Upgrade to `nitropack@0.6` and `h3@0.8` ([#8218](https://github.com/nuxt/cli/pull/8218))
- **nuxi:** `nuxi build-module` command ([#7610](https://github.com/nuxt/cli/pull/7610))
- **nuxt:** Auto-import `utils/` directory ([#8817](https://github.com/nuxt/cli/pull/8817))
- **nuxi:** Wrap and normalize all console outputs ([#8846](https://github.com/nuxt/cli/pull/8846))
- **nuxi:** ⚠️  Setup nuxt globally with `nuxt test` ([#4578](https://github.com/nuxt/cli/pull/4578))
- **nuxi:** Auto-generate `.npmrc` and setting for pnpm ([#7407](https://github.com/nuxt/cli/pull/7407))
- **nuxi:** Warn when prerendering routes with `ssr: false` ([#18783](https://github.com/nuxt/cli/pull/18783))
- **nuxi:** Add initial support for enabling/disabling devtools ([#18864](https://github.com/nuxt/cli/pull/18864))
- **nuxt:** Upgrade to nitropack 2.2 ([#18889](https://github.com/nuxt/cli/pull/18889))
- **nuxi:** Enforce consistent casing in filenames ([#19088](https://github.com/nuxt/cli/pull/19088))
- **nuxi:** Reload nuxt when `restart` hook is called ([#19084](https://github.com/nuxt/cli/pull/19084))
- **nuxi:** Cli wrapper for self restart ([#18641](https://github.com/nuxt/cli/pull/18641))
- **nuxi,schema:** Add support for setting nuxt `logLevel` ([#19369](https://github.com/nuxt/cli/pull/19369))
- **cli:** Programmatically pass nuxt config overrides (to dev) ([#19371](https://github.com/nuxt/cli/pull/19371))
- **nuxt:** Add `watch` option and refactor dev server restarting ([#19530](https://github.com/nuxt/cli/pull/19530))
- **nuxt:** Prompt to install `devtools` when it's enabled ([#20126](https://github.com/nuxt/cli/pull/20126))
- Upgrade to consola v3.x prerelease ([#20141](https://github.com/nuxt/cli/pull/20141))
- **nuxi:** Allow greater control of `nuxi analyze` from cli ([#20387](https://github.com/nuxt/cli/pull/20387))
- **deps:** Upgrade to nitropack v2.4 ([#20688](https://github.com/nuxt/cli/pull/20688))
- **nuxi:** Allow passing overrides to other nuxi commands ([#20760](https://github.com/nuxt/cli/pull/20760))
- Add `module add` command ([#9](https://github.com/nuxt/cli/pull/9))
- Check for cli updates in background ([#11](https://github.com/nuxt/cli/pull/11))
- Add cli version to `nuxi info` ([604843137](https://github.com/nuxt/cli/commit/604843137))
- Show basic changelog url in update banner ([#15](https://github.com/nuxt/cli/pull/15))
- **nuxi:** Module search ([#21](https://github.com/nuxt/cli/pull/21))
- **init:** Allow selecting package manager when creating new project ([#38](https://github.com/nuxt/cli/pull/38))
- **kit,nuxi:** Add `writeTypes` utility ([#22385](https://github.com/nuxt/cli/pull/22385))
- **nuxi:** Detect `bun` package manager ([#22673](https://github.com/nuxt/cli/pull/22673))
- Forked dev server ([#81](https://github.com/nuxt/cli/pull/81))
- Support bun package manager ([#86](https://github.com/nuxt/cli/pull/86))
- Use listhen to parse its own `dev` args ([#88](https://github.com/nuxt/cli/pull/88))
- Allow using internal `_dev` command for testing purpose ([#94](https://github.com/nuxt/cli/pull/94))

### 🔥 Performance

- Remove unused deps and add implicit deps ([#20356](https://github.com/nuxt/cli/pull/20356))
- **nuxt:** Use `.test` and hoist regexps where possible ([#21011](https://github.com/nuxt/cli/pull/21011))
- **prepare:** Normalise compiler options once ([b86fad588](https://github.com/nuxt/cli/commit/b86fad588))

### 🩹 Fixes

- **pkg:** Avoid conflicting `nuxt` binraries ([#512](https://github.com/nuxt/cli/pull/512))
- **pkg:** Enable declaration for for and webpack ([718a79650](https://github.com/nuxt/cli/commit/718a79650))
- **cli:** Restart on `app.vue` creation and removal ([#597](https://github.com/nuxt/cli/pull/597))
- **nuxi:** Don't restart when build directory changes ([#613](https://github.com/nuxt/cli/pull/613))
- **nuxi:** Fix issue with dynamic cjs chunks ([2f6c5a6fc](https://github.com/nuxt/cli/commit/2f6c5a6fc))
- **nuxi:** Don't include `nuxt3` for bridge projects ([#663](https://github.com/nuxt/cli/pull/663))
- **nuxt3:** Provide `NuxtWelcome` component from design ([#745](https://github.com/nuxt/cli/pull/745))
- **nuxi:** Dx improvements when creating `components/` directory ([#749](https://github.com/nuxt/cli/pull/749))
- **nuxi:** Provide install advice if git fails ([#923](https://github.com/nuxt/cli/pull/923))
- **nuxi:** Respect `--port` arg ([#919](https://github.com/nuxt/cli/pull/919))
- **nuxi:** Warn if user does not have `@nuxt/kit` installed ([#915](https://github.com/nuxt/cli/pull/915))
- **cli:** Update listhen (resolves #1032, #1033) ([#1032](https://github.com/nuxt/cli/issues/1032), [#1033](https://github.com/nuxt/cli/issues/1033))
- **nuxi:** Update version and vite detection ([#1169](https://github.com/nuxt/cli/pull/1169))
- **deps:** Upgrade jiti to 2.12.9 ([#1171](https://github.com/nuxt/cli/pull/1171))
- **nuxi:** Write `tsconfig` when generating `buildDir` ([#1161](https://github.com/nuxt/cli/pull/1161))
- **nuxi:** Ignore watch events if nuxt instance is not ready ([06208af6a](https://github.com/nuxt/cli/commit/06208af6a))
- **pkg:** Downgrade node version to 14.17.x due to codesandbox issue ([6a4118420](https://github.com/nuxt/cli/commit/6a4118420))
- **pkg:** Downgrade node version to 14.16.x due to stackblitz issue ([dd28aafcd](https://github.com/nuxt/cli/commit/dd28aafcd))
- **nuxi:** Support `build:error` hook ([#1298](https://github.com/nuxt/cli/pull/1298))
- **nuxi:** Correct analyzer html ([#1339](https://github.com/nuxt/cli/pull/1339))
- **nuxi:** Validate template argument ([#1409](https://github.com/nuxt/cli/pull/1409))
- **nuxi:** Validations for `--template` flag ([#1412](https://github.com/nuxt/cli/pull/1412))
- **nuxi:** Ensure types are calculated on current nuxt instance ([#1432](https://github.com/nuxt/cli/pull/1432))
- **pkg:** Support node 17.x  in the engines field ([#1443](https://github.com/nuxt/cli/pull/1443))
- **nuxi:** Write types after nuxt is ready ([#1551](https://github.com/nuxt/cli/pull/1551))
- **nuxi:** Remove nu alias ([a4a9b8e9d](https://github.com/nuxt/cli/commit/a4a9b8e9d))
- **nuxi:** Forward `nuxi generate` to `nuxt` on nuxt 2 ([#1571](https://github.com/nuxt/cli/pull/1571))
- **nuxt3:** Expose `nuxi` command ([f21d26c05](https://github.com/nuxt/cli/commit/f21d26c05))
- **nuxi:** Generate types with `nuxi generate` ([#1625](https://github.com/nuxt/cli/pull/1625))
- **nuxi, kit:** Import individual semver function ([#1598](https://github.com/nuxt/cli/pull/1598))
- **nuxi:** Satisfies isn't always default export ([#1643](https://github.com/nuxt/cli/pull/1643))
- **nuxi:** Allow starting `nuxi dev` with self signed certificate ([#1699](https://github.com/nuxt/cli/pull/1699))
- **nitro, nuxi:** Add runtimeConfig types (for `#config` and `useRuntimeConfig()`) ([#1783](https://github.com/nuxt/cli/pull/1783))
- **nuxi:** Default to skipping lib check ([#1824](https://github.com/nuxt/cli/pull/1824))
- **nuxi:** Set `allowSyntheticDefaultImports` ([#1827](https://github.com/nuxt/cli/pull/1827))
- **bridge:** Plugin default detection ([#1847](https://github.com/nuxt/cli/pull/1847))
- **nuxi:** Create buildDir before writing types ([#1930](https://github.com/nuxt/cli/pull/1930))
- **nuxi:** Handle missing typescript options in build ([#1972](https://github.com/nuxt/cli/pull/1972))
- **nuxi:** Ignore static check with `prepare` command ([#1971](https://github.com/nuxt/cli/pull/1971))
- **bridge:** Exclude bridge alias types to support Volar ([#2013](https://github.com/nuxt/cli/pull/2013))
- **cli:** Enable `usage` command ([#2079](https://github.com/nuxt/cli/pull/2079))
- **nuxi:** Add `nuxt3` to dev deps in upgrade command ([#2143](https://github.com/nuxt/cli/pull/2143))
- **nuxi:** Ensure buildDir exists before write ([d2c4a8ec9](https://github.com/nuxt/cli/commit/d2c4a8ec9))
- **nuxi:** Respect custom pages directory ([#2813](https://github.com/nuxt/cli/pull/2813))
- **nuxi,nuxt3,bridge:** Generate all templates with `nuxi prepare` ([#2409](https://github.com/nuxt/cli/pull/2409))
- **nuxi:** Updated rmdir to rm and checked paths exists ([#2968](https://github.com/nuxt/cli/pull/2968))
- **config:** Add analyze plugin options in bridge mode ([#3292](https://github.com/nuxt/cli/pull/3292))
- **nuxi:** Don't clear screen on `nuxi dev --help` ([#3372](https://github.com/nuxt/cli/pull/3372))
- **nuxi:** Use new `builder` option for vite/webpack info ([#3658](https://github.com/nuxt/cli/pull/3658))
- Ensure debounced/async handlers run in order ([#3656](https://github.com/nuxt/cli/pull/3656))
- Use `perfect-debounce` to handle trailing run of promise ([#3679](https://github.com/nuxt/cli/pull/3679))
- **bridge:** Handle missing `experimental` key on bridge ([#3763](https://github.com/nuxt/cli/pull/3763))
- **nuxi:** Respect `NUXT_PORT` and `NUXT_HOST` vars in dev mode ([#3973](https://github.com/nuxt/cli/pull/3973))
- **nuxi:** Ignore buildDir on windows too ([#3999](https://github.com/nuxt/cli/pull/3999))
- **nuxi:** Use rm rather than rmdir ([#4100](https://github.com/nuxt/cli/pull/4100))
- Regressions from nitropack migration ([#4157](https://github.com/nuxt/cli/pull/4157))
- **nuxi:** Update `api` template to event format ([#4183](https://github.com/nuxt/cli/pull/4183))
- **cli:** Close process by default after command invokation ([#4192](https://github.com/nuxt/cli/pull/4192))
- **cli:** Disable cjs bridge ([#4336](https://github.com/nuxt/cli/pull/4336))
- **nuxi:** Call listen hook on each restart ([#4346](https://github.com/nuxt/cli/pull/4346))
- **nuxi:** Strip extensions from absolute paths (for types) ([#4300](https://github.com/nuxt/cli/pull/4300))
- **nuxi:** Don't kill analyze command ([#4462](https://github.com/nuxt/cli/pull/4462))
- **nuxi:** Use `rc` tag for upgrade command of nuxt ([#4468](https://github.com/nuxt/cli/pull/4468))
- **nuxi:** Don't strip file extensions from dirs in `tsconfig` ([#4595](https://github.com/nuxt/cli/pull/4595))
- **nuxi:** Typo in init message ([#4685](https://github.com/nuxt/cli/pull/4685))
- **nuxi:** Improve `nuxi init` output ([#4612](https://github.com/nuxt/cli/pull/4612))
- **nuxi:** Only reload for top level dirs ([#4912](https://github.com/nuxt/cli/pull/4912))
- **nuxi:** Always override `NODE_ENV` ([#5417](https://github.com/nuxt/cli/pull/5417))
- **nuxi:** Show base url in terminal ([#5337](https://github.com/nuxt/cli/pull/5337))
- **pkg:** Use fixed version range for monorepo packages ([#5933](https://github.com/nuxt/cli/pull/5933))
- **nuxi:** Add missing `types` field ([#5962](https://github.com/nuxt/cli/pull/5962))
- **nuxi:** Load `.env` file before starting dev server ([#6119](https://github.com/nuxt/cli/pull/6119))
- **nuxi, kit:** Enable `esmResolve` flag for `jiti` ([#6356](https://github.com/nuxt/cli/pull/6356))
- **nuxi:** Upgrade `listhen` ([#6434](https://github.com/nuxt/cli/pull/6434))
- **nuxi:** Fix issues with `nuxi upgrade` ([#6514](https://github.com/nuxt/cli/pull/6514))
- **nuxi:** Update `server.port` and `server.host` with listener info ([#6595](https://github.com/nuxt/cli/pull/6595))
- **nuxi:** Ensure `nuxi upgrade` runs in rootDir ([#6707](https://github.com/nuxt/cli/pull/6707))
- **nuxi:** Properly detect hash and tag for upgrade changelog ([#6708](https://github.com/nuxt/cli/pull/6708))
- **nuxi:** Build all types on typecheck command ([#5437](https://github.com/nuxt/cli/pull/5437))
- **nuxi:** Fix version search path ([#7133](https://github.com/nuxt/cli/pull/7133))
- **kit, nuxi:** Semver regexp to support `nuxt-edge` current releases (bridge) ([#7193](https://github.com/nuxt/cli/pull/7193))
- **nuxi:** Pass value of `https` through to vite-node ([#7271](https://github.com/nuxt/cli/pull/7271))
- **nuxi:** Don't include an array of paths within an array ([#7378](https://github.com/nuxt/cli/pull/7378))
- **nuxi:** Improved self-signed certificate for `nuxi dev --https` ([#7545](https://github.com/nuxt/cli/pull/7545))
- **nuxi, vite:** Ipv6 support for `nuxi dev` ([#7560](https://github.com/nuxt/cli/pull/7560))
- **nuxi:** Print resolved public directory after generate ([#7577](https://github.com/nuxt/cli/pull/7577))
- **nuxi:** Backward compatibility for kit <= rc.10 without `useNitro` ([#7593](https://github.com/nuxt/cli/pull/7593))
- **nuxi, vite:** Support https with custom domain and hmr ([#7680](https://github.com/nuxt/cli/pull/7680))
- **nuxi:** Include `workspaceDir` in tsconfig include ([#7726](https://github.com/nuxt/cli/pull/7726))
- **nuxi:** Stub `defineNuxtConfig` for `nuxi info` ([#7728](https://github.com/nuxt/cli/pull/7728))
- **nuxi:** Replace lazyHandle to defineLazyHandler ([#8049](https://github.com/nuxt/cli/pull/8049))
- **nuxi:** Don't include`workspaceDir` in tsconfig by default ([#8256](https://github.com/nuxt/cli/pull/8256))
- Update h3 ([#8329](https://github.com/nuxt/cli/pull/8329))
- **nuxi:** Update analzye main handler ([#8339](https://github.com/nuxt/cli/pull/8339))
- **nuxt, nuxi:** Improve `pages` creation and removal dx ([#8502](https://github.com/nuxt/cli/pull/8502))
- **nuxi:** Exclude `dist` from type checking ([#8848](https://github.com/nuxt/cli/pull/8848))
- **nuxt:** ⚠️  Enable payload extraction only for `nuxi generate` ([#9018](https://github.com/nuxt/cli/pull/9018))
- **nuxi:** Upgrade with `latest` tag ([#9060](https://github.com/nuxt/cli/pull/9060))
- **nuxi:** Show an error if no value is supplied for the `--template` flag ([#9946](https://github.com/nuxt/cli/pull/9946))
- **nuxi:** Prevent showing stack traces while scaffolding ([#9962](https://github.com/nuxt/cli/pull/9962))
- Use named export from `defu` in all places ([#18624](https://github.com/nuxt/cli/pull/18624))
- **nuxi:** Pass through exit code from test errors ([#18959](https://github.com/nuxt/cli/pull/18959))
- **nuxi:** Read `devServer` options from nuxt config ([#19055](https://github.com/nuxt/cli/pull/19055))
- **nuxi:** Upgrade `giget` ([48ea0c46d](https://github.com/nuxt/cli/commit/48ea0c46d))
- **nuxi:** Restart nuxt when `distDir` is unlinked ([#19131](https://github.com/nuxt/cli/pull/19131))
- **nuxi:** Avoid top-level await in wrapper ([89310df1a](https://github.com/nuxt/cli/commit/89310df1a))
- **cli:** Handle different kind of shutdown signals ([#19485](https://github.com/nuxt/cli/pull/19485))
- **nuxi:** Resolve kit from nuxt modules dir ([#19601](https://github.com/nuxt/cli/pull/19601))
- **schema:** Show `payloadExtraction` warning only when unset ([#18516](https://github.com/nuxt/cli/pull/18516))
- **nuxi:** Use file url to start nuxi ([#19676](https://github.com/nuxt/cli/pull/19676))
- **nuxi:** Watch dist and register restart hook after nuxt is ready ([#19736](https://github.com/nuxt/cli/pull/19736))
- **nuxi:** Preview nitro build with custom dir config ([#18882](https://github.com/nuxt/cli/pull/18882))
- **nuxi, vite:** Suppress sourcemap + native fetch warnings ([#20198](https://github.com/nuxt/cli/pull/20198))
- **nuxi:** Load kit from `rootDir` when preparing project ([#20401](https://github.com/nuxt/cli/pull/20401))
- **deps:** Relax upper node version constraint ([#20472](https://github.com/nuxt/cli/pull/20472))
- **nuxi,schema:** Support `devServer.https: true` ([#20498](https://github.com/nuxt/cli/pull/20498))
- **nuxi:** Hard-reload nuxt when `.env` changes ([#20501](https://github.com/nuxt/cli/pull/20501))
- **nuxi:** Pass `--no-clear` config through to vite ([#21262](https://github.com/nuxt/cli/pull/21262))
- **nuxi:** Always use the latest devtools wizard ([#21291](https://github.com/nuxt/cli/pull/21291))
- **nuxi,nuxt:** Remove baseUrl + use relative paths in tsconfig ([#21081](https://github.com/nuxt/cli/pull/21081))
- Remove boxen dependency ([e9c9b49e8](https://github.com/nuxt/cli/commit/e9c9b49e8))
- **prepare:** Use absolute paths for aliases ([#44](https://github.com/nuxt/cli/pull/44))
- **nuxi:** Resolve `@nuxt/ui-templates` from `modulesDir` ([#21836](https://github.com/nuxt/cli/pull/21836))
- **nuxt:** Ensure static presets equivalent to `nuxi generate` ([#21860](https://github.com/nuxt/cli/pull/21860))
- **nuxi:** Respect nitro ssl cert/key variables ([#21912](https://github.com/nuxt/cli/pull/21912))
- Disable update checker temporarily ([7cab9de39](https://github.com/nuxt/cli/commit/7cab9de39))
- Export `runMain` ([50ef441f2](https://github.com/nuxt/cli/commit/50ef441f2))
- **cli:** Add aliases to monorepo paths to tsconfig includes ([#21997](https://github.com/nuxt/cli/pull/21997))
- **cli:** Allow non-existent `experimental` option ([58603415b](https://github.com/nuxt/cli/commit/58603415b))
- **nuxi:** Only strip extensions from files ([#22399](https://github.com/nuxt/cli/pull/22399))
- Log restart message ([d3ee170b8](https://github.com/nuxt/cli/commit/d3ee170b8))
- **nuxi:** Only watch `distDir` after first build ([#22614](https://github.com/nuxt/cli/pull/22614))
- Expose `/cli` export for backwards compatibility ([97a8029a4](https://github.com/nuxt/cli/commit/97a8029a4))
- **nuxi:** Ignore error if nitro is not enabled on bridge ([#22642](https://github.com/nuxt/cli/pull/22642))
- Reverse conditions to default to v3 ([#82](https://github.com/nuxt/cli/pull/82))
- Bump kit/schema and remove from externals ([af0d9df11](https://github.com/nuxt/cli/commit/af0d9df11))
- Respect PORT/HOST variables in dev mode ([#93](https://github.com/nuxt/cli/pull/93))

### 💅 Refactors

- Rename `nuxt-cli` to `nuxi` ([#430](https://github.com/nuxt/cli/pull/430))
- Merge modules to `nuxt3` ([#439](https://github.com/nuxt/cli/pull/439))
- Migrate from upath to pathe ([#553](https://github.com/nuxt/cli/pull/553))
- **nuxi:** Extract nitro types to corresponding modules ([#668](https://github.com/nuxt/cli/pull/668))
- Use `p-debounce` everywhere ([#977](https://github.com/nuxt/cli/pull/977))
- **nuxi:** Move `nuxt.d.ts` within `buildDir` ([#1369](https://github.com/nuxt/cli/pull/1369))
- **nuxi:** Info output package manager version ([#1564](https://github.com/nuxt/cli/pull/1564))
- Remove unnecessary optional chaining ([#1991](https://github.com/nuxt/cli/pull/1991))
- Split schema to `@nuxt/schema` and simplify kit ([#2059](https://github.com/nuxt/cli/pull/2059))
- Write declarations to `<buildDir>/types` ([#3067](https://github.com/nuxt/cli/pull/3067))
- **nuxi:** Remove `rimraf` dependency ([#4308](https://github.com/nuxt/cli/pull/4308))
- ⚠️  Rename nuxt3 to nuxt ([#4449](https://github.com/nuxt/cli/pull/4449))
- **nuxi:** Provide better advice on failing clone ([#5155](https://github.com/nuxt/cli/pull/5155))
- **nuxi:** Improve env update message ([#5430](https://github.com/nuxt/cli/pull/5430))
- Enable strict type checking everywhere ([#6943](https://github.com/nuxt/cli/pull/6943))
- **nuxt:** ⚠️  Cleanup schema and split nuxt 2 types ([#8487](https://github.com/nuxt/cli/pull/8487))
- Update unjs dependencies to stable v1 ([#9011](https://github.com/nuxt/cli/pull/9011))
- ⚠️  Remove deprecated api ([#9029](https://github.com/nuxt/cli/pull/9029))
- Split out type imports from value imports ([#9225](https://github.com/nuxt/cli/pull/9225))
- **nuxi:** Hard restart with communication channel ([#19423](https://github.com/nuxt/cli/pull/19423))
- **kit,nuxi:** Resolve module paths using node algorithm ([#19537](https://github.com/nuxt/cli/pull/19537))
- Move cli to standalone package ([60064ece4](https://github.com/nuxt/cli/commit/60064ece4))
- Use consola box for update banner ([550f71f33](https://github.com/nuxt/cli/commit/550f71f33))
- **init:** Minor improvements ([#45](https://github.com/nuxt/cli/pull/45))
- Migrate to `citty` ([#47](https://github.com/nuxt/cli/pull/47))
- **cli,schema:** Add `bundler` module resolution flag ([#22142](https://github.com/nuxt/cli/pull/22142))
- **nuxi,schema:** Move loading template into schema ([#22336](https://github.com/nuxt/cli/pull/22336))
- Add typecheck and fix ts issues ([#79](https://github.com/nuxt/cli/pull/79))

### 📖 Documentation

- Fix typo in nuxi analyze output ([#3022](https://github.com/nuxt/cli/pull/3022))
- Link to nuxt.com instead of v3.nuxtjs.org ([#9786](https://github.com/nuxt/cli/pull/9786))
- Update `generate` doc to include `--dotenv` ([#9991](https://github.com/nuxt/cli/pull/9991))
- Update readme ([#90](https://github.com/nuxt/cli/pull/90))

### 📦 Build

- **deps:** Update all non-major dependencies ([#4387](https://github.com/nuxt/cli/pull/4387))
- Update `unbuild` and `pkg-types` ([97d993a85](https://github.com/nuxt/cli/commit/97d993a85))
- **nuxi:** Add `node` to export conditions ([7b355e637](https://github.com/nuxt/cli/commit/7b355e637))
- **pkg:** Support node 19 ([#8324](https://github.com/nuxt/cli/pull/8324))

### 🏡 Chore

- Update to unbuild 0.5.x ([#545](https://github.com/nuxt/cli/pull/545))
- Update design version ([099433265](https://github.com/nuxt/cli/commit/099433265))
- **eslint:** Forbid modules importing from core ([#556](https://github.com/nuxt/cli/pull/556))
- Update base major versions to 3.x for simplicity ([d9c75d212](https://github.com/nuxt/cli/commit/d9c75d212))
- **nuxi:** Use consola for consistency ([#686](https://github.com/nuxt/cli/pull/686))
- Add readme to packages ([#727](https://github.com/nuxt/cli/pull/727))
- **eslint:** Fix lint error ([3751fb766](https://github.com/nuxt/cli/commit/3751fb766))
- **nuxi:** Improve typing in nuxi dev script ([#1064](https://github.com/nuxt/cli/pull/1064))
- Fix eslint issue ([45d629b33](https://github.com/nuxt/cli/commit/45d629b33))
- **docs:** Add code format using markdownlint ([#1498](https://github.com/nuxt/cli/pull/1498), [#1556](https://github.com/nuxt/cli/pull/1556))
- Update help information ([#1605](https://github.com/nuxt/cli/pull/1605))
- **nuxi:** Add pnpm to `init` instructions ([#3826](https://github.com/nuxt/cli/pull/3826))
- Update links for new sitemap ([#4286](https://github.com/nuxt/cli/pull/4286))
- Use `node:` prefix for built-in modules ([#4384](https://github.com/nuxt/cli/pull/4384))
- Bump node dependencies ([#4440](https://github.com/nuxt/cli/pull/4440))
- Update packages to 3.0.0-rc.0 ([d20e4ab13](https://github.com/nuxt/cli/commit/d20e4ab13))
- **nuxi:** Add notice for generate deployment ([#4474](https://github.com/nuxt/cli/pull/4474))
- **release:** V3.0.0-rc.1 ([5753ffe82](https://github.com/nuxt/cli/commit/5753ffe82))
- Enable typecheck ci for packages ([#4664](https://github.com/nuxt/cli/pull/4664))
- Downgrade node v16 minor ([#7865](https://github.com/nuxt/cli/pull/7865))
- Update internal repo/issue links to use`nuxt/nuxt` ([9bf672093](https://github.com/nuxt/cli/commit/9bf672093))
- Trigger ci ([39a7ea17e](https://github.com/nuxt/cli/commit/39a7ea17e))
- Update more repo links ([206b42544](https://github.com/nuxt/cli/commit/206b42544))
- Include central readme/licence when publishing individual packages ([#18421](https://github.com/nuxt/cli/pull/18421))
- Bump version to v3.1.1 ([#18524](https://github.com/nuxt/cli/pull/18524))
- Update `2.x` branch name ([8559c8d67](https://github.com/nuxt/cli/commit/8559c8d67))
- Increase node 14 minor version constraint ([#19111](https://github.com/nuxt/cli/pull/19111))
- Update nitropack and unjs dependencies ([#19100](https://github.com/nuxt/cli/pull/19100))
- Use pnpm workspace protocol internally ([#19962](https://github.com/nuxt/cli/pull/19962))
- Upgrade to consola v3 ([#20194](https://github.com/nuxt/cli/pull/20194))
- Remove `@ts-ignore` and fix some issues ([#20273](https://github.com/nuxt/cli/pull/20273))
- Move v2 docs to v2.nuxt.com ([b4ab0aeef](https://github.com/nuxt/cli/commit/b4ab0aeef))
- Update banner title ([72c145a94](https://github.com/nuxt/cli/commit/72c145a94))
- Lint and cleanup ([d918d5ea6](https://github.com/nuxt/cli/commit/d918d5ea6))
- Add playground ([0011a9689](https://github.com/nuxt/cli/commit/0011a9689))
- Lint ([2555e4c1b](https://github.com/nuxt/cli/commit/2555e4c1b))
- Add autofix ci ([38b74984d](https://github.com/nuxt/cli/commit/38b74984d))
- Update to prettier v3 ([25dd37674](https://github.com/nuxt/cli/commit/25dd37674))
- Update readme ([960c1dfb8](https://github.com/nuxt/cli/commit/960c1dfb8))
- Update readme ([32cc73e0b](https://github.com/nuxt/cli/commit/32cc73e0b))
- Fix lint issue ([442fab890](https://github.com/nuxt/cli/commit/442fab890))
- Update dependencies and unbuild ([8f15ab933](https://github.com/nuxt/cli/commit/8f15ab933))

### ✅ Tests

- **nuxt3:** Add unit tests for `generateRoutesFromFiles` ([#261](https://github.com/nuxt/cli/pull/261), [#1227](https://github.com/nuxt/cli/pull/1227))
- Rework tests using `@nuxt/test-utils` ([#3308](https://github.com/nuxt/cli/pull/3308))

### 🎨 Styles

- Enable `sort-imports` eslint rule ([#20133](https://github.com/nuxt/cli/pull/20133))
- Lint ([9f39b059b](https://github.com/nuxt/cli/commit/9f39b059b))

### 🤖 CI

- Add edge release step ([#51](https://github.com/nuxt/cli/pull/51))

#### ⚠️ Breaking Changes

- ⚠️  Add `engines.node` field and node.js version check ([#1197](https://github.com/nuxt/cli/pull/1197))
- ⚠️  Migrate to nitropack ([#3956](https://github.com/nuxt/cli/pull/3956))
- **cli:** ⚠️  Use giget 0.1x with template registry for `nuxi init` ([#7404](https://github.com/nuxt/cli/pull/7404))
- ⚠️  Upgrade to `nitropack@0.6` and `h3@0.8` ([#8218](https://github.com/nuxt/cli/pull/8218))
- **nuxi:** ⚠️  Setup nuxt globally with `nuxt test` ([#4578](https://github.com/nuxt/cli/pull/4578))
- **nuxt:** ⚠️  Enable payload extraction only for `nuxi generate` ([#9018](https://github.com/nuxt/cli/pull/9018))
- ⚠️  Rename nuxt3 to nuxt ([#4449](https://github.com/nuxt/cli/pull/4449))
- **nuxt:** ⚠️  Cleanup schema and split nuxt 2 types ([#8487](https://github.com/nuxt/cli/pull/8487))
- ⚠️  Remove deprecated api ([#9029](https://github.com/nuxt/cli/pull/9029))

### ❤️ Contributors

- Pooya Parsa ([@pi0](http://github.com/pi0))
- Daniel Roe <daniel@roe.dev>
- Colin McDonnell ([@colinhacks](http://github.com/colinhacks))
- Ryota Watanabe 
- Samuel Burkhard <sxburk@gmail.com>
- Damian Głowala 
- Anthony Fu <anthonyfu117@hotmail.com>
- Sébastien Chopin ([@Atinux](http://github.com/Atinux))
- Jonas Thelemann ([@dargmuesli](http://github.com/dargmuesli))
- Xjccc ([@xjccc](http://github.com/xjccc))
- Hyunseung Lee ([@hslee2008](http://github.com/hslee2008))
- Sebastian Landwehr ([@dword-design](http://github.com/dword-design))
- Jakub Andrzejewski 
- Julien Huang <julien.huang@outlook.fr>
- Hamish Claxton ([@Verequies](http://github.com/Verequies))
- Alex <self@pirsig.net>
- James George <jamesgeorge998001@gmail.com>
- Daniil Chudo ([@daniil4udo](http://github.com/daniil4udo))
- Percy Ma ([@kecrily](http://github.com/kecrily))
- Christian Preston ([@cpreston321](http://github.com/cpreston321))
- Cupid Valentine 
- AndreyYolkin <andreyyolkin@gmail.com>
- Alex Kozack 
- Conrawl Rogers ([@Diizzayy](http://github.com/Diizzayy))
- Harlan Wilton ([@harlan-zw](http://github.com/harlan-zw))
- Yoho ([@poyoho](http://github.com/poyoho))
- Ennio Visconti ([@ennioVisco](http://github.com/ennioVisco))
- Max Programming 
- Ben Sheedy ([@sanscheese](http://github.com/sanscheese))
- Clément Ollivier ([@clemcode](http://github.com/clemcode))
- Dizzy Rogers 
- Jfavlam <jfavlam@gmail.com>
- Xin Du (Clark) <clark.duxin@gmail.com>
- Keith Bremner <keith@humbl.dev>
- Nandi95 
- Levi (Nguyễn Lương Huy) ([@huynl-96](http://github.com/huynl-96))
- Mgs. M. Rizqi Fadhlurrahman ([@rizqirizqi](http://github.com/rizqirizqi))

