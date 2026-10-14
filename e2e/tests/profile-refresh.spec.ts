import { expect, test } from '@playwright/test'

import { asUser, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: the profile is fetched the same way at every size, and desktop always shows
// the signed-in name in the navigation

test('shows a profile changed in another session once this tab is back in focus', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  // The tab's first check records what the server last changed, which later checks compare with
  const firstCheck = page.waitForResponse((response) => response.url().endsWith('/me/cache-status'))
  await openPage(page, '/accounts')
  await firstCheck
  const navigation = page.getByRole('navigation', { name: 'Primary', exact: true })
  await expect(navigation.getByText(user.firstName, { exact: true })).toBeVisible()

  // Another device renames the user, and this tab only learns of it from the server
  const renamed = await request.patch(`${API_BASE_URL}/me`, {
    headers: asUser(user),
    data: { first_name: 'Renamed', last_name: 'Elsewhere' },
  })
  expect(renamed.status()).toBe(200)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))

  await expect(navigation.getByText('Renamed Elsewhere', { exact: true })).toBeVisible()
  await expect(navigation.getByText(user.firstName, { exact: true })).toHaveCount(0)
})
