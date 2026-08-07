/**
 * The instance the suite runs against.
 *
 * The suite starts nothing and stops nothing. Something else brings an instance up and hands
 * the address over, which is what lets the same specs run against a staging server, a
 * container on a pipeline runner, or anything else already serving.
 */

// Required, with no default, so a run cannot quietly go at whatever happens to be on a
// familiar port
const configured = process.env.E2E_BASE_URL
if (configured === undefined || configured === '') {
  throw new Error('E2E_BASE_URL is required, as E2E_BASE_URL=http://127.0.0.1:8080 npx playwright test')
}

export const BASE_URL = configured.replace(/\/$/, '')

// Long enough to cover a container that has just been started, short enough that pointing at
// nothing fails while you are still watching
const REACHABLE_TIMEOUT_MS = 60_000
const REACHABLE_POLL_MS = 2_000

/**
 * Fail before any test runs when nothing is serving at the address.
 *
 * Without this, a wrong or unstarted address appears as a browser timeout inside whichever
 * spec happened to run first, which reads as that spec being broken.
 *
 * @throws When the health route has not answered ok before the timeout expires
 */
export async function requireAppReachable(): Promise<void> {
  const deadline = Date.now() + REACHABLE_TIMEOUT_MS
  let lastAttempt = 'no response'

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/api/health`, {
        signal: AbortSignal.timeout(REACHABLE_POLL_MS),
      })
      if (response.ok) {
        const body = (await response.json()) as { status?: string }
        if (body.status === 'ok') {
          return
        }
        lastAttempt = `health answered ${JSON.stringify(body.status)}`
      } else {
        lastAttempt = `answered ${response.status}`
      }
    } catch (error) {
      lastAttempt = error instanceof Error ? error.message : String(error)
    }
    await new Promise((settle) => setTimeout(settle, REACHABLE_POLL_MS))
  }

  throw new Error(
    `nothing healthy at ${BASE_URL} after ${REACHABLE_TIMEOUT_MS / 1000}s, last attempt: ${lastAttempt}`,
  )
}
