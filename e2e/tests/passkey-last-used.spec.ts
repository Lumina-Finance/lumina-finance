/**
 * Guards when each passkey was last used, as the Multi-factor authentication dialog words it, which
 * once kept the words it had when the dialog opened however long it then stayed open
 */
import { expect, test } from '@playwright/test'

import { signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: the words are worked out the same way at every size

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

// Answered here, so each passkey's last use can be timed against the page's clock, which a real
// sign-in with a passkey can't be
test("keeps each passkey's last used words current while the dialog stays open", async ({ page, request }) => {
  const user = await signUpUser(request)
  const openedAt = Date.now()
  const passkey = (name: string, lastUsedMsAgo: number | null) => ({
    id: name,
    name,
    created_at: new Date(openedAt - 7 * DAY_MS).toISOString(),
    last_used_at: lastUsedMsAgo === null ? null : new Date(openedAt - lastUsedMsAgo).toISOString(),
  })
  await page.route(`${API_BASE_URL}/auth/passkeys`, (route) => route.fulfill({
    json: [
      passkey('Laptop', 5 * 1000),
      passkey('Phone', 3 * HOUR_MS),
      passkey('Tablet', 2 * DAY_MS),
      passkey('Security key', null),
    ],
  }))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.install({ time: openedAt })
  await logInViaApi(page, user)
  await openPage(page, '/settings#security')
  await page.locator('#security').getByRole('button', { name: 'Manage', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Multi-factor authentication' })
  await expect(dialog.getByText('last used just now')).toBeVisible()
  await expect(dialog.getByText('last used 3 hours ago')).toBeVisible()
  await expect(dialog.getByText('last used 2 days ago')).toBeVisible()
  await expect(dialog.getByText('not used yet')).toBeVisible()

  await page.clock.fastForward(10 * MINUTE_MS)
  await expect(dialog.getByText('last used 10 minutes ago')).toBeVisible()
  await expect(dialog.getByText('last used just now')).toHaveCount(0)

  await page.clock.fastForward(110 * MINUTE_MS)
  await expect(dialog.getByText('last used 2 hours ago')).toBeVisible()
  await expect(dialog.getByText('last used 5 hours ago')).toBeVisible()
  await expect(dialog.getByText('last used 2 days ago')).toBeVisible()
  await expect(dialog.getByText('not used yet')).toBeVisible()
})
