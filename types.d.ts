/* eslint-disable no-var */

declare global {
  var __nuxt_cli__:
    | undefined
    | {
      entry: string
      startTime: number
    }
}

export {}
