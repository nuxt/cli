import process from 'node:process'

const DISPLAY_REQUIRED_PLATFORMS = new Set<NodeJS.Platform>(['linux', 'freebsd', 'openbsd'])

/**
 * Whether a graphical session exists to receive a clipboard write or a browser
 * launch. The tools involved on Linux and BSD (`wl-copy`, `xsel`, `xclip`,
 * `xdg-open`) all need one, and fail in unhelpful ways without it: clipboard
 * tools exit before reading their input, so the write fails with `EPIPE`.
 */
export function hasDisplayServer(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!DISPLAY_REQUIRED_PLATFORMS.has(process.platform)) {
    return true
  }
  return !!(env.WSL_DISTRO_NAME || env.WAYLAND_DISPLAY || env.DISPLAY)
}
