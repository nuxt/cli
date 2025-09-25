export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({}))

  return {
    message: 'Echo API endpoint',
    echoed: body,
    headers: getRequestHeaders(event),
    method: event.method,
    timestamp: new Date().toISOString(),
  }
})
