import { expect, test, type Locator } from '@playwright/test'

import { signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { ACROSS_ORIGINS } from '../support/origins'
import { currentTotp, enrollTotp } from '../support/totp'

// Runs in the cross-origin project only: the attempts left come in a header the browser reads only when
// the API is on another origin. Its width is the desktop one

// A code the authenticator will not show for the next few steps, so Verify refuses it
const WRONG_CODE = '000000'

// The least the modal's top edge rises as the message opens room, since the modal is centred: half the
// message's height, which is far more
const MIN_RISE_PX = 10

/**
 * Runs the action that gets a refusal and asserts the modal held no blank room for the message: its top edge
 * rises once the message shows, because the modal grows by the message's height and stays centred
 */
async function expectModalOpensForMessage(modal: Locator, refuse: () => Promise<void>): Promise<void> {
  // The modal's own opening animation is let finish first, so only the refusal's move is counted
  let lastTop: number | undefined
  await expect.poll(async () => {
    const top = await modal.evaluate((panel) => panel.getBoundingClientRect().top)
    const held = top === lastTop
    lastTop = top
    return held
  }, { intervals: [150] }).toBe(true)

  const topBefore = lastTop!
  await refuse()
  await expect(modal.getByRole('alert')).toContainText(/\d+ attempts? remaining/)
  await expect.poll(async () => topBefore - await modal.evaluate((panel) => panel.getBoundingClientRect().top))
    .toBeGreaterThanOrEqual(MIN_RISE_PX)
}

test('opens the step-up modal for the message when a code is refused', ACROSS_ORIGINS, async ({ page, request }) => {
  const user = await signUpUser(request)
  const secret = await enrollTotp(request, user)

  await page.goto('/login')
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill(user.password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.getByLabel('One-time code').fill(currentTotp(secret))
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))

  // Changing the password asks for the second factor in the step-up modal, which has only the code step
  await openPage(page, '/settings#security')
  const newPassword = `${user.password}-new1`
  await page.getByLabel('Current password').fill(user.password)
  await page.getByLabel('New password', { exact: true }).fill(newPassword)
  await page.getByLabel('Confirm new password').fill(newPassword)
  await page.locator('#security').getByRole('button', { name: 'Save' }).click()

  const modal = page.getByRole('dialog')
  await modal.getByLabel('One-time code').pressSequentially(WRONG_CODE)
  await expectModalOpensForMessage(modal, () => page.getByRole('button', { name: 'Verify' }).click())
})

test('opens the step-up modal for the message when a password is refused', ACROSS_ORIGINS, async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings#security')
  await page.locator('#security').getByRole('button', { name: 'Manage' }).click()
  await page.getByRole('button', { name: 'Enable' }).click()

  const modal = page.getByRole('dialog', { name: 'Turn on two-factor authentication' })
  await modal.getByLabel('Current password').fill(`${user.password}-wrong`)
  await expectModalOpensForMessage(modal, () => modal.getByRole('button', { name: 'Continue' }).click())
})
