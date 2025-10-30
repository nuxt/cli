import { mkdir, writeFile } from 'node:fs/promises'
import { defineNuxtModule, useNuxt } from '@nuxt/kit'
import { join } from 'pathe'

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
