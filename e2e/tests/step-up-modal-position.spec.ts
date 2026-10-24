import { expect, test } from '@playwright/test'

import { signUpUser } from '../support/api'
import { openPage } from '../support/app'
import { ACROSS_ORIGINS } from '../support/origins'
import { currentTotp, enrollTotp } from '../support/totp'

// Runs in the cross-origin project only: the attempts left come in a header the browser reads only when
// the API is on another origin. Its width is the desktop one, and the room kept for the message is laid
// out from the message itself, so it holds at any width

// A code the authenticator will not show for the next few steps, so Verify refuses it
const WRONG_CODE = '000000'

// Frames to wait after the message shows, for the modal's height easing of about a quarter of a second to finish
const SETTLE_FRAMES = 60

// A refused code shows its message and the attempts left in a callout. The modal is centred, so room that
// opens up for the message moves the whole modal, which must not happen even while it eases
test('keeps the step-up modal where it is when a code is refused', ACROSS_ORIGINS, async ({ page, request }) => {
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
  await page.getByRole('button', { name: 'Verify' }).click()
  await expect(modal.getByRole('alert')).toContainText(/\d+ attempts? remaining/)

  const framesNow = () => page.evaluate(() => (window as unknown as { modalTops: number[] }).modalTops.length)
  const framesAtMessage = await framesNow()
  await expect.poll(framesNow).toBeGreaterThan(framesAtMessage + SETTLE_FRAMES)

  const tops = await page.evaluate(() => (window as unknown as { modalTops: number[] }).modalTops)
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(1)
})
