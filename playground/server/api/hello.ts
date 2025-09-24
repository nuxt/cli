export default defineEventHandler(async (event) => {
  return {
    message: 'Hello from API!',
    timestamp: new Date().toISOString(),
    method: event.method,
    url: getRequestURL(event).pathname,
  }
})
