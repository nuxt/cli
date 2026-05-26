import process from 'node:process'
import { Agent, EnvHttpProxyAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici'

// Node's built-in `fetch` (undici) ignores `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` unless
// the process was started with `node --use-env-proxy` (Node 24+, experimental).
// `nuxi init`, `nuxi module add`, `nuxi info`, etc. all do outbound HTTP at startup; behind
// a corporate proxy that silently fails. Install undici's `EnvHttpProxyAgent` as the global
// dispatcher so every CLI-time `fetch` honours the standard env vars.
// Refs:
//   https://nodejs.org/api/cli.html#--use-env-proxy
//   https://undici.nodejs.org/#/docs/api/EnvHttpProxyAgent
export function installProxyDispatcher(): void {
  const proxyUrl
    = process.env.HTTPS_PROXY
      || process.env.https_proxy
      || process.env.HTTP_PROXY
      || process.env.http_proxy
  if (!proxyUrl) {
    return
  }

  const current = getGlobalDispatcher()
  if (current instanceof EnvHttpProxyAgent) {
    return
  }
  if (current.constructor !== Agent) {
    return
  }

  setGlobalDispatcher(new EnvHttpProxyAgent())
}
