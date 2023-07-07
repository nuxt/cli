// should be above node 16.10.0
export function isCompatibleNodeVersion() {
    const [major, minor] = process.version.slice(1).split('.').map(Number)
    return major > 16 || (major === 16 && minor >= 10)
}