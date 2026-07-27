import process from 'node:process'

import { provider as currentProvider } from 'std-env'

/**
 * Resolve the reachable editor URL for a dev server running inside StackBlitz
 * or Codeflow, where the app is served through the editor rather than on a
 * port the user can open locally.
 *
 * The project is identified by the working directory: `/home/projects/<id>`
 * in the editor, `/home/<org>/<repo>` in Codeflow. `PWD` is used rather than
 * `process.cwd()` because the latter is resolved through symlinks.
 */
export function resolveStackblitzURL(
  env: NodeJS.ProcessEnv = process.env,
  provider: string | undefined = currentProvider,
): string | undefined {
  if (provider !== 'stackblitz') {
    return undefined
  }

  const cwd = env.PWD
  if (!cwd) {
    return undefined
  }

  if (cwd.startsWith('/home/projects/')) {
    const projectId = cwd.split('/')[3]
    return projectId ? `https://stackblitz.com/edit/${projectId}` : undefined
  }

  if (cwd.startsWith('/home/')) {
    const [owner, repository] = cwd.split('/').slice(2)
    return owner && repository ? `https://stackblitz.com/edit/~/github.com/${owner}/${repository}` : undefined
  }

  return undefined
}
