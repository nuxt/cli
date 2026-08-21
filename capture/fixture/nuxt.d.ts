declare global {
  function defineNuxtConfig(config: any): any
  function defineEventHandler(handler: any): any
  function defineTask(task: any): any
  function useRuntimeConfig(): any
}

export {}
