import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defineNuxtModule, useNuxt } from '@nuxt/kit'

export default defineNuxtModule({
  meta: {
    name: 'nuxt-cli-test-vite-hosts',
  },
  setup() {
    const nuxt = useNuxt()

    nuxt.hook('vite:configResolved', async (config, { isClient }) => {
      if (!isClient) {
        return
      }
      await writeFile(join(nuxt.options.rootDir, '.nuxt/vite-hosts.json'), JSON.stringify({
        allowedHosts: config.server?.allowedHosts,
      }))
      await nuxt.close()
    })
  },
})
