import { expect, test, type Locator, type Page } from '@playwright/test'

import { signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { ACROSS_ORIGINS } from '../support/origins'
import { currentTotp, enrollTotp } from '../support/totp'

// Runs in the cross-origin project only: the attempts left come in a header the browser reads only when
// the API is on another origin. Its width is the desktop one

// A code the authenticator will not show for the next few steps, so Verify refuses it
const WRONG_CODE = '000000'

// Frames to wait after the message shows, for the modal's height easing of about a quarter of a second to finish
const SETTLE_FRAMES = 60

// Distinct heights the top edge holds while the modal opens for the message: its start, its end and at
// least one between, where a jump would show only the start and the end
const MIN_POSITIONS_WHILE_EASING = 3

/**
 * Runs the action that gets a refusal and asserts the modal's top edge passes through positions between its
 * start and its end while the message comes in. The modal holds no blank room for the message, and is
 * centred, so it eases open by the message's height rather than jumping
 */
async function expectModalStillWhileRefused(page: Page, modal: Locator, refuse: () => Promise<void>): Promise<void> {
  // The modal's own opening animation is let finish first, so only a move caused by the refusal is counted
  let lastTop: number | undefined
  await expect.poll(async () => {
    const top = await modal.evaluate((panel) => panel.getBoundingClientRect().top)
    const held = top === lastTop
    lastTop = top
    return held
  }, { intervals: [150] }).toBe(true)

  // Every frame's top edge is noted from here on, so a move that has eased back by the end still shows
  await modal.evaluate((panel) => {
    const tops: number[] = []
    const note = () => { tops.push(panel.getBoundingClientRect().top); requestAnimationFrame(note) }
    note()
    Object.assign(window, { modalTops: tops })
  })
  await refuse()
  await expect(modal.getByRole('alert')).toContainText(/\d+ attempts? remaining/)

  const framesNow = () => page.evaluate(() => (window as unknown as { modalTops: number[] }).modalTops.length)
  const framesAtMessage = await framesNow()
  await expect.poll(framesNow).toBeGreaterThan(framesAtMessage + SETTLE_FRAMES)

  const tops = await page.evaluate(() => (window as unknown as { modalTops: number[] }).modalTops)
  const restingTop = tops[0]
  const heldPositions = new Set(tops.map((top) => Math.round(top)))
  expect(tops[tops.length - 1]).toBeLessThan(restingTop)
  expect(heldPositions.size).toBeGreaterThanOrEqual(MIN_POSITIONS_WHILE_EASING)
}

test('eases the step-up modal open when a code is refused', ACROSS_ORIGINS, async ({ page, request }) => {
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
  await expectModalStillWhileRefused(page, modal, () => page.getByRole('button', { name: 'Verify' }).click())
})

test('eases the step-up modal open when a password is refused', ACROSS_ORIGINS, async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings#security')
  await page.locator('#security').getByRole('button', { name: 'Manage' }).click()
  await page.getByRole('button', { name: 'Enable' }).click()

  const modal = page.getByRole('dialog', { name: 'Turn on two-factor authentication' })
  await modal.getByPlaceholder('Current password').fill(`${user.password}-wrong`)
  await expectModalStillWhileRefused(page, modal, () => modal.getByRole('button', { name: 'Continue' }).click())
})
