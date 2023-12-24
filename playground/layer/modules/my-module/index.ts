import { createResolver, defineNuxtModule } from '@nuxt/kit'

export default defineNuxtModule({
  meta: { name: 'my-module' },
  setup(_resolvedOptions, nuxt) {
    const { resolve } = createResolver(import.meta.url);
    nuxt.options.alias['#my-module'] = resolve('./runtime')
  },
})
