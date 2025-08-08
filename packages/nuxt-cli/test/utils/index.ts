import { isCI } from 'std-env'

export async function fetchWithPolling(url: string, options: RequestInit = {}, maxAttempts = 10, interval = 100): Promise<Response | null> {
  let response: Response | null = null
  let attempts = 0
  while (attempts < maxAttempts) {
    try {
      response = await fetch(url, options)
      if (response.ok) {
        return response
      }
    }
    catch {
      // Ignore errors and retry
    }
    attempts++
    await new Promise(resolve => setTimeout(resolve, isCI ? interval * 10 : interval))
  }
  return response
}
