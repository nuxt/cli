export async function checkEngines({
  currentNode = process.versions.node,
  nodeRange = '>= 18.0.0',
} = {}) {
  const satisfies = await import('semver/functions/satisfies.js').then(
    (r) =>
      r.default || (r as any as typeof import('semver/functions/satisfies.js')),
  ) // npm/node-semver#381

  if (!satisfies(currentNode, nodeRange)) {
    console.warn(
      `Current version of Node.js (\`${currentNode}\`) is unsupported and might cause issues.\n       Please upgrade to a compatible version \`${nodeRange}\`.`,
    )
  }
}
