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

  const failedCheck = page.waitForEvent('requestfailed', (failed) => failed.url().endsWith('/me/cache-status'))
  await page.clock.fastForward('01:30')
  await failedCheck
  expect(checks).toBe(2)

  // The failure has reached the page, which has set the next try by now
  await page.evaluate(() => undefined)
  await page.clock.fastForward('01:30')
  await expect.poll(() => checks).toBe(3)
  await expect.poll(() => accountReads).toBeGreaterThan(readsBeforeMidnight)
})
