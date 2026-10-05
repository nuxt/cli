/** Repositories whose releases are published under a `v`-prefixed tag. */
const RELEASE_REPOS: Record<string, string> = {
  'nuxt': 'nuxt/nuxt',
  '@nuxt/cli': 'nuxt/cli',
  'nuxi': 'nuxt/cli',
  'create-nuxt': 'nuxt/cli',
}

/**
 * The release notes for a published version, when the package has a known
 * repository. Nightlies are skipped: their versions have no matching tag.
 */
export function releaseNotesUrl(pkg: string, version: string): string | undefined {
  const repo = RELEASE_REPOS[pkg]
  if (!repo || version.includes('nightly')) {
    return undefined
  }
  return `https://github.com/${repo}/releases/tag/v${version}`
}
