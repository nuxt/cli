import { defineEventHandler, getQuery } from 'h3'

export default defineEventHandler(async (event) => {
  ;(globalThis as { __hangToken?: string }).__hangToken = String(getQuery(event).token)
  await new Promise(() => {})
})
