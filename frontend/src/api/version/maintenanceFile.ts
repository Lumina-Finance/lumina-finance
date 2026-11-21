import { hasMaintenanceMarker } from '@/api/auth/errors'
import { getMaintenanceEndCount, reportMaintenance } from '@/api/version/serverState'

// Where whoever runs the site announces a maintenance when the server can't announce it itself. It
// sits at the page's own address. A web server in front of the app can keep serving it while the app
// behind it is down
const MAINTENANCE_FILE_URL = `${import.meta.env.BASE_URL}maintenance.json`

// A burst of failed requests asks once, and a page whose requests keep failing asks no more often than
// this, since the page's own retry runs every minute
export const MAINTENANCE_FILE_MIN_INTERVAL_MS = 15_000

// A host that accepts the connection and never answers would otherwise hold the one ask open until the
// browser gives up, and block every later ask meanwhile
export const MAINTENANCE_FILE_TIMEOUT_MS = 10_000

let inFlight: Promise<void> | null = null
let lastAskedAt = Number.NEGATIVE_INFINITY

async function readMaintenanceFile() {
  const endCountAtAsk = getMaintenanceEndCount()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MAINTENANCE_FILE_TIMEOUT_MS)
  try {
    const response = await fetch(MAINTENANCE_FILE_URL, { cache: 'no-store', signal: controller.signal })
    if (!response.ok) return
    const body: unknown = await response.json()

    // An answer from the app while the file was on its way proves the app is running, whatever the
    // file still says
    if (hasMaintenanceMarker(body) && getMaintenanceEndCount() === endCountAtAsk) reportMaintenance(true)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Asks the page's own address whether the site is in maintenance, after a request the server never
 * answered. Only a file holding the maintenance marker counts. No file, an answer that isn't JSON and
 * no answer at all each leave what the page says as it was. A web server that answers an address it
 * doesn't know with the app's own page gives an answer that isn't JSON. The end of a maintenance is
 * left to the next answer the app makes, and a file that arrives after one counts for nothing
 */
export function checkMaintenanceFile(): Promise<void> {
  if (inFlight) return inFlight
  const now = Date.now()
  const sinceLastAsk = now - lastAskedAt

  // A clock set back since the last ask gives a negative time. Asks would stay blocked until it caught up
  if (sinceLastAsk >= 0 && sinceLastAsk < MAINTENANCE_FILE_MIN_INTERVAL_MS) return Promise.resolve()
  lastAskedAt = now
  inFlight = readMaintenanceFile()
    .catch(() => undefined)
    .finally(() => {
      inFlight = null
    })
  return inFlight
}
