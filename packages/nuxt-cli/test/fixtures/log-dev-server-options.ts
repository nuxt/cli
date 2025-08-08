import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defineNuxtModule, useNuxt } from '@nuxt/kit'

export default defineNuxtModule({
  meta: {
    name: 'nuxt-cli-test-module',
  },
  setup() {
    const nuxt = useNuxt()

    nuxt.hook('build:before', async () => {
      await mkdir('.nuxt', { recursive: true })
      await writeFile(join(nuxt.options.rootDir, '.nuxt/dev-server.json'), JSON.stringify(nuxt.options.devServer))
      await nuxt.close()
    })
  },
})
