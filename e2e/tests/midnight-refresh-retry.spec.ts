import { expect, test } from '@playwright/test'

import { createAccount, daysFromTodayInTestTimezone, signUpUser, startOfDayInTestTimezone } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: the refresh is a timer in the app shell, the same at every size

// The server answers by the real clock, which a fake browser clock can't move past midnight, so the
// test answers the cache check itself with the new day's date token. Motion is reduced because the suite
// does so for every test on a fake clock, which holds the browser's own fades
test.use({ reducedMotion: 'reduce' })

const DAY_MS = 24 * 60 * 60 * 1000

// The wait the page sets after a check that failed. No other setTimeout of the page waits exactly this long
const RETRY_INTERVAL_MS = 60_000

// A failed check is not reported to the app shell until the page has read the maintenance file, so the
// retry is set a little after the failure, not with it. A slow connection makes that gap long
const MAINTENANCE_FILE_DELAY_MS = 1000

type TimerLog = { retriesSet: number }

test('refreshes calculated amounts when the date token changes at midnight, trying again a minute after a failed check', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday Chequing' })
  const midnight = startOfDayInTestTimezone(daysFromTodayInTestTimezone(1))

  // The first check reports today's token and the coming midnight, the second fails as it does when the
  // connection drops overnight, and the third reports the next day's token
  let checks = 0
  await page.route(`${API_BASE_URL}/me/cache-status`, async (route) => {
    checks += 1
    if (checks === 2) {
      await route.abort()
      return
    }
    const response = await route.fetch()
    const status = await response.json() as Record<string, unknown>
    await route.fulfill({
      response,
      json: {
        ...status,
        calculation_date_token: checks === 1 ? 'first-day' : 'second-day',
        next_calculation_boundary_at: checks === 1 ? midnight.toISOString() : new Date(midnight.getTime() + DAY_MS).toISOString(),
      },
    })
  })
  await page.route('**/maintenance.json', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, MAINTENANCE_FILE_DELAY_MS))
    await route.continue()
  })
  let accountReads = 0
  page.on('request', (sent) => {
    if (sent.method() === 'GET' && sent.url() === `${API_BASE_URL}/accounts/${account.id}`) accountReads += 1
  })

  // A minute before midnight, so the day turns over with the page open
  await logInViaApi(page, user)
  await page.clock.install({ time: midnight.getTime() - 60_000 })
  await openPage(page, `/accounts/${account.id}`)
  await expect.poll(() => checks).toBe(1)
  const readsBeforeMidnight = accountReads
  expect(readsBeforeMidnight).toBeGreaterThan(0)

  // Counts the waits of exactly a retry's length that the page asks its clock for from here on
  await page.evaluate((interval) => {
    const log = window as unknown as TimerLog
    log.retriesSet = 0
    const setTimer = window.setTimeout
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      if (timeout === interval) log.retriesSet += 1
      return setTimer(handler, timeout, ...args)
    }) as typeof window.setTimeout
  }, RETRY_INTERVAL_MS)

  const failedCheck = page.waitForEvent('requestfailed', (failed) => failed.url().endsWith('/me/cache-status'))
  await page.clock.fastForward('01:30')
  await failedCheck
  expect(checks).toBe(2)

  // The clock moves past a wait only if the page set that wait before the jump, so the jump waits for the retry
  await expect.poll(() => page.evaluate(() => (window as unknown as TimerLog).retriesSet)).toBe(1)
  await page.clock.fastForward('01:30')
  await expect.poll(() => checks).toBe(3)
  await expect.poll(() => accountReads).toBeGreaterThan(readsBeforeMidnight)
})
