/* eslint-disable no-var */

declare global {
  var __NUXT_PREPATHS__: undefined | string[]
  var __NUXT_PATHS__: undefined | string[]
  var __nuxt_cli__:
    | undefined
    | {
        entry: string
        startTime: number
      }
}

export {}
