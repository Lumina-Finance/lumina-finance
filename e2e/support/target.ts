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

export const BASE_URL = configured.replace(/\/+$/, '')

// The API address includes its path prefix, such as /api, so split deployments can hand
// over their externally reachable API without changing where the browser navigates
const configuredApi = process.env.E2E_API_BASE_URL
if (configuredApi === '') {
  throw new Error('E2E_API_BASE_URL must be a full API base URL when supplied')
}
export const API_BASE_URL = (configuredApi ?? `${BASE_URL}/api`).replace(/\/+$/, '')

for (const [name, value] of [['E2E_BASE_URL', BASE_URL], ['E2E_API_BASE_URL', API_BASE_URL]] as const) {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.search || url.hash) {
      throw new Error('expected HTTP or HTTPS without a query or fragment')
    }
  } catch {
    throw new Error(`${name} must be a full HTTP or HTTPS base URL without a query or fragment`)
  }
}

// Long enough to cover a container that has just been started, short enough that pointing at
// nothing fails while you are still watching
const REACHABLE_TIMEOUT_MS = 60_000
const REACHABLE_POLL_MS = 2_000

/**
 * Poll one target and describe its last response if it never becomes ready.
 *
 * Frontend reachability and API health are separate because either can be stopped in a split
 * deployment while the other continues serving
 */
async function requireTargetReachable(url: string, isHealthyApi: boolean): Promise<void> {
  const deadline = Date.now() + REACHABLE_TIMEOUT_MS
  let lastAttempt = 'no response'

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(REACHABLE_POLL_MS),
      })
      if (response.ok) {
        if (!isHealthyApi) {
          return
        }
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
    `${isHealthyApi ? 'API not healthy' : 'frontend not reachable'} at ${url} after ${REACHABLE_TIMEOUT_MS / 1000}s, last attempt: ${lastAttempt}`,
  )
}

/**
 * Fail before any test runs when the frontend or API is unavailable.
 *
 * @throws When the frontend has not answered successfully or API health has not answered ok
 * before the timeout expires
 */
export async function requireAppReachable(): Promise<void> {
  await Promise.all([
    requireTargetReachable(BASE_URL, false),
    requireTargetReachable(`${API_BASE_URL}/health`, true),
  ])
}
