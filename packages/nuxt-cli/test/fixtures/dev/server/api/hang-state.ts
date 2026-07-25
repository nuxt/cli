import { defineEventHandler, getQuery } from 'h3'

export default defineEventHandler((event) => {
  const token = (globalThis as { __hangToken?: string }).__hangToken
  return { started: !!token && token === String(getQuery(event).token) }
})
