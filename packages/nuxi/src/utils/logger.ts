import { consola } from 'consola'
import { colors } from 'consola/utils'

export const logger = consola.withTag(colors.whiteBright(colors.bold(colors.bgGreenBright('nuxi'))))
