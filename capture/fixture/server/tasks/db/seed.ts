export default defineTask({
  meta: {
    name: 'db:seed',
    description: 'Seed the database with demo content',
  },
  run() {
    return { result: 'seeded' }
  },
})
