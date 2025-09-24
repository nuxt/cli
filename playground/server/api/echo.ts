export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({}))

  return {
    message: 'Echo API endpoint',
    echoed: body,
    method: event.method,
    timestamp: new Date().toISOString(),
  }
})
