import { writeFile } from 'node:fs/promises'
import process from 'node:process'
import { defineNuxtModule, useNuxt } from 'nuxt/kit'

export default defineNuxtModule({
  meta: {
    name: 'nuxt-cli-test-module',
  },
  setup() {
    const nuxt = useNuxt()

    nuxt.hook('build:before', async () => {
      await writeFile('.nuxt/dev-server.json', JSON.stringify(nuxt.options.devServer))
      await nuxt.close()
      process.exit(0)
    })
  },
})
