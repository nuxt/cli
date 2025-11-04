declare global {
  // eslint-disable-next-line vars-on-top
  var __nuxt_cli__:
    | undefined
    | {
      entry: string
      devEntry?: string
      startTime: number
    }
}

export {}
