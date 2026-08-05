import type { ShjLanguageDefinition, ShjToken } from '@speed-highlight/core'

import { styleText } from 'node:util'

import cssLanguage from '@speed-highlight/core/languages/css.js'
import htmlLanguage from '@speed-highlight/core/languages/html.js'
import jsLanguage from '@speed-highlight/core/languages/js.js'
import templateLanguage, { type as templateType } from '@speed-highlight/core/languages/js_template_literals.js'
import jsdocLanguage, { type as jsdocType } from '@speed-highlight/core/languages/jsdoc.js'
import jsonLanguage from '@speed-highlight/core/languages/json.js'
import regexLanguage, { type as regexType } from '@speed-highlight/core/languages/regex.js'
import todoLanguage, { type as todoType } from '@speed-highlight/core/languages/todo.js'

type Style = Parameters<typeof styleText>[0]

interface Language {
  sub: ShjLanguageDefinition
  type?: ShjToken
}

/**
 * The languages `highlight` can be asked for, plus the ones their definitions
 * reach through a nested `sub`. Importing each definition by its own subpath
 * keeps the unused ones out of the bundle.
 */
const LANGUAGES: Record<string, Language> = {
  css: { sub: cssLanguage as ShjLanguageDefinition },
  html: { sub: htmlLanguage as ShjLanguageDefinition },
  js: { sub: jsLanguage as ShjLanguageDefinition },
  js_template_literals: { sub: templateLanguage as ShjLanguageDefinition, type: templateType as ShjToken },
  jsdoc: { sub: jsdocLanguage as ShjLanguageDefinition, type: jsdocType as ShjToken },
  json: { sub: jsonLanguage as ShjLanguageDefinition },
  regex: { sub: regexLanguage as ShjLanguageDefinition, type: regexType as ShjToken },
  todo: { sub: todoLanguage as ShjLanguageDefinition, type: todoType as ShjToken },
}

/** Language for a nested `sub` we deliberately do not bundle: emit its text unstyled. */
const PLAIN: Language = { sub: [] }

/** `common.js` in `@speed-highlight/core` is not part of its export map, so the shared rules are inlined. */
const EXPANSIONS: Record<string, { type: ShjToken, match: RegExp }> = {
  num: { type: 'num', match: /(\.e?|\b)\d(e-|[\d.oxa-fA-F_])*(\.|\b)/g },
  str: { type: 'str', match: /(["'])(\\[\s\S]|(?!\1)[^\r\n\\])*\1?/g },
  strDouble: { type: 'str', match: /"((?!")[^\r\n\\]|\\[\s\S])*"?/g },
}

const THEME: Partial<Record<ShjToken, Style>> = {
  bool: 'yellow',
  class: 'yellow',
  cmnt: 'gray',
  deleted: 'red',
  err: 'red',
  esc: 'cyan',
  func: 'cyan',
  insert: 'green',
  kwd: 'magenta',
  num: 'magenta',
  oper: 'dim',
  section: 'magenta',
  str: 'green',
  type: 'blue',
  var: 'blue',
}

interface Rule {
  type?: ShjToken
  match?: RegExp
  expand?: string
  sub?: string | ShjLanguageDefinition | ((code: string) => Language)
}

type Emit = (text: string, token?: ShjToken) => void

/**
 * Walk `src` with the rules of `lang`, handing each token to `emit`.
 *
 * A port of `tokenize` from `@speed-highlight/core`, which is only reachable
 * through an entry that statically bundles every language it ships.
 */
function tokenize(src: string, lang: Language, emit: Emit): void {
  const rules = [...lang.sub] as Rule[]
  const matches: ({ match: RegExpExecArray, lastIndex: number } | undefined)[] = []
  let position = 0

  while (position < src.length) {
    let best: { rule: Rule, index: number, match: string, end: number } | undefined

    for (let index = rules.length - 1; index >= 0; index--) {
      const rule = rules[index]!.expand ? EXPANSIONS[rules[index]!.expand!]! : rules[index]!
      const cached = matches[index]
      if (!cached || cached.match.index < position) {
        rule.match!.lastIndex = position
        const match = rule.match!.exec(src)
        if (!match) {
          rules.splice(index, 1)
          matches.splice(index, 1)
          continue
        }
        matches[index] = { match, lastIndex: rule.match!.lastIndex }
      }
      const current = matches[index]!
      if (current.match[0] && (!best || current.match.index <= best.index)) {
        best = { rule, index: current.match.index, match: current.match[0], end: current.lastIndex }
      }
    }

    if (!best) {
      break
    }

    emit(src.slice(position, best.index), lang.type)
    position = best.end

    const { sub } = best.rule
    if (!sub) {
      emit(best.match, best.rule.type)
      continue
    }
    if (typeof sub === 'string') {
      tokenize(best.match, LANGUAGES[sub] ?? PLAIN, emit)
    }
    else if (typeof sub === 'function') {
      tokenize(best.match, sub(best.match), emit)
    }
    else {
      tokenize(best.match, { sub, type: best.rule.type }, emit)
    }
  }

  emit(src.slice(position), lang.type)
}

/**
 * Colour the tokens of a document, leaving its text untouched.
 *
 * `styleText` writes no escapes when stdout cannot show them, so piped output
 * stays parseable by `jq` and friends.
 */
export function highlight(code: string, language: 'json' | 'html'): string {
  let output = ''
  try {
    tokenize(code, LANGUAGES[language]!, (text, token) => {
      const style = token && THEME[token]
      output += style && text ? styleText(style, text) : text
    })
  }
  catch {
    return code
  }
  return output
}
