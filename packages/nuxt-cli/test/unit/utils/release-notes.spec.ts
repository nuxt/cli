import { describe, expect, it } from 'vitest'

import { terminalLink } from '../../../src/utils/formatting'
import { releaseNotesUrl } from '../../../src/utils/release-notes'

describe('release notes links', () => {
  it('points at the tag for packages with a known repository', () => {
    expect(releaseNotesUrl('nuxt', '4.6.0')).toBe('https://github.com/nuxt/nuxt/releases/tag/v4.6.0')
    expect(releaseNotesUrl('@nuxt/cli', '3.1.0')).toBe('https://github.com/nuxt/cli/releases/tag/v3.1.0')
  })

  it('has nothing to link for nightlies or unknown packages', () => {
    expect(releaseNotesUrl('nuxt', '4.6.0-nightly.20240101')).toBeUndefined()
    expect(releaseNotesUrl('some-other-package', '1.0.0')).toBeUndefined()
  })

  it('emits a hyperlink only where the terminal supports one', () => {
    expect(terminalLink('4.6.0', 'https://example.com', { stream: { isTTY: false } })).toBe('4.6.0')
  })
})
