import { defineCommand } from 'citty'

import { commandMeta } from './meta'
import preview from './preview'

export default defineCommand({
  ...preview,
  meta: commandMeta.start,
})
