export default defineTask({
  meta: {
    name: 'cache:clear',
    description: 'Clear the cached pages and data',
  },
  run() {
    return { result: 'cleared' }
  },
})
