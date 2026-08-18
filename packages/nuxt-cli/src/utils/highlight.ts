import type { ShjGrammar, ShjLanguageData, ShjToken } from '@speed-highlight/core'

import { styleText } from 'node:util'

import bashLanguage from '@speed-highlight/core/languages/bash.js'
import cssLanguage from '@speed-highlight/core/languages/css.js'
import diffLanguage from '@speed-highlight/core/languages/diff.js'
import htmlLanguage from '@speed-highlight/core/languages/html.js'
import httpLanguage from '@speed-highlight/core/languages/http.js'
import jsLanguage from '@speed-highlight/core/languages/js.js'
import jsdocLanguage from '@speed-highlight/core/languages/jsdoc.js'
import jsonLanguage from '@speed-highlight/core/languages/json.js'
import mdLanguage from '@speed-highlight/core/languages/md.js'
import pyLanguage from '@speed-highlight/core/languages/py.js'
import regexLanguage from '@speed-highlight/core/languages/regex.js'
import todoLanguage from '@speed-highlight/core/languages/todo.js'
import tsLanguage from '@speed-highlight/core/languages/ts.js'
import yamlLanguage from '@speed-highlight/core/languages/yaml.js'
import { tokenizeWith } from '@speed-highlight/core/tokenize'

/** The languages `highlight` can be asked for by name. */
export type HighlightLanguage = 'bash' | 'css' | 'diff' | 'html' | 'http' | 'js' | 'json' | 'md' | 'py' | 'ts' | 'yaml'

type Style = Parameters<typeof styleText>[0]

/**
 * The HTML rules with embedded script blocks read as TypeScript, which is what
 * a single-file component's `<script setup lang="ts">` almost always holds.
 */
function typedScripts(grammar: ShjGrammar): ShjGrammar {
  return grammar.map((rule) => {
    const sub = 'sub' in rule ? rule.sub : undefined
    if (sub === 'js') {
      return { ...rule, sub: 'ts' }
    }
    if (Array.isArray(sub)) {
      return { ...rule, sub: typedScripts(sub) }
    }
    return rule
  }) as ShjGrammar
}

/**
 * The languages `highlight` can be asked for, plus the ones their definitions
 * reach through a nested `sub`. Importing each definition by its own subpath
 * keeps the unused ones out of the bundle.
 */
const LANGUAGES: Record<string, ShjLanguageData> = {
  bash: bashLanguage,
  css: cssLanguage,
  diff: diffLanguage,
  html: htmlLanguage,
  http: httpLanguage,
  js: jsLanguage,
  jsdoc: jsdocLanguage,
  json: jsonLanguage,
  // ATX headings are missing from the upstream grammar (speed-highlight/core#76).
  md: [{ type: 'section', match: /^#{1,6} .*/gm }, ...mdLanguage],
  py: pyLanguage,
  regex: regexLanguage,
  todo: todoLanguage,
  ts: tsLanguage,
  vue: typedScripts(htmlLanguage),
  yaml: yamlLanguage,
}

const ALIASES: Record<string, string> = {
  console: 'bash',
  javascript: 'js',
  markdown: 'md',
  mjs: 'js',
  mts: 'ts',
  patch: 'diff',
  python: 'py',
  sh: 'bash',
  shell: 'bash',
  typescript: 'ts',
  xml: 'html',
  yml: 'yaml',
  zsh: 'bash',
}

/**
 * Markdown hands us the whole info string of a fence, which in Nuxt docs is
 * routinely `ts twoslash` or `vue [app.vue]`, so only the first word counts.
 * An unknown language stays unresolved, so its region keeps the type of the
 * rule embedding it.
 */
const RESOLVER = new Proxy(LANGUAGES, {
  get(languages, name: string) {
    const key = name.trim().split(/[\s,{[]/)[0]!.toLowerCase()
    return languages[ALIASES[key] ?? key]
  },
})

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

/**
 * Colour the tokens of a document, leaving its text untouched.
 *
 * `styleText` writes no escapes when stdout cannot show them, so piped output
 * stays parseable by `jq` and friends.
 */
export function highlight(code: string, language: HighlightLanguage): string {
  let output = ''
  try {
    tokenizeWith(code, LANGUAGES[language]!, (text, token) => {
      const style = token && THEME[token]
      output += style && text ? styleText(style, text) : text
    }, { languages: RESOLVER })
  }
  catch {
    return code
  }
  return output
}
