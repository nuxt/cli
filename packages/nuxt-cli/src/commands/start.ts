import { defineCommand } from 'citty'

import preview from './preview'

export default defineCommand({
  ...preview,
  meta: {
    name: 'start',
    description: 'Launches Nitro server for local testing after `nuxt build`.',
    hidden: true,
  },
})
