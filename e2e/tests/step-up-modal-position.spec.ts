import { expect, test, type Locator, type Page } from '@playwright/test'

import { signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { ACROSS_ORIGINS } from '../support/origins'
import { currentTotp, enrollTotp } from '../support/totp'

// Runs in the cross-origin project only: the attempts left come in a header the browser reads only when
// the API is on another origin. Its width is the desktop one

// A code the authenticator will not show for the next few steps, so Verify refuses it
const WRONG_CODE = '000000'

// The least time between the top edge's first frame off its start and its last frame short of its end: the
// height eases over about a quarter of a second, where a jump lands in one frame and leaves no time between
// them. A busy host draws few frames, so the bar is far under the easing's own length
const MIN_EASING_MS = 30

/**
 * Runs the action that gets a refusal and asserts the modal's top edge moves up over a stretch of time while
 * the message comes in. The modal holds no blank room for the message, and is centred, so it eases open by
 * the message's height rather than jumping
 */
async function expectModalEasedWhileRefused(page: Page, modal: Locator, refuse: () => Promise<void>): Promise<void> {
  // The modal's own opening animation is let finish first, so only a move caused by the refusal is counted
  let lastTop: number | undefined
  await expect.poll(async () => {
    const top = await modal.evaluate((panel) => panel.getBoundingClientRect().top)
    const held = top === lastTop
    lastTop = top
    return held
  }, { intervals: [150] }).toBe(true)

  // Each frame's top edge is noted with its time from here on, so the move's start and end can be told
  await modal.evaluate((panel) => {
    const frames: { time: number; top: number }[] = []
    const note = () => { frames.push({ time: performance.now(), top: panel.getBoundingClientRect().top }); requestAnimationFrame(note) }
    note()
    Object.assign(window, { modalFrames: frames })
  })
  await refuse()
  await expect(modal.getByRole('alert')).toContainText(/\d+ attempts? remaining/)

  type Frames = { time: number; top: number }[]
  const readFrames = () => page.evaluate(() => (window as unknown as { modalFrames: Frames }).modalFrames)

  // Settled once the top edge has held still for half a second after having moved
  await expect.poll(async () => {
    const frames = await readFrames()
    const last = frames[frames.length - 1]
    const lastMove = frames.findLast((frame) => Math.abs(frame.top - last.top) >= 0.5)
    return lastMove !== undefined && last.time - lastMove.time > 500
  }, { intervals: [200] }).toBe(true)

  const frames = await readFrames()
  const restingTop = frames[0].top
  const firstMove = frames.find((frame) => Math.abs(frame.top - restingTop) >= 0.5)!
  const finalTop = frames[frames.length - 1].top
  const lastMove = frames.findLast((frame) => Math.abs(frame.top - finalTop) >= 0.5)!
  expect(finalTop).toBeLessThan(restingTop)
  expect(lastMove.time - firstMove.time).toBeGreaterThanOrEqual(MIN_EASING_MS)
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
  await expectModalEasedWhileRefused(page, modal, () => page.getByRole('button', { name: 'Verify' }).click())
})

test('eases the step-up modal open when a password is refused', ACROSS_ORIGINS, async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings#security')
  await page.locator('#security').getByRole('button', { name: 'Manage' }).click()
  await page.getByRole('button', { name: 'Enable' }).click()

  const modal = page.getByRole('dialog', { name: 'Turn on two-factor authentication' })
  await modal.getByPlaceholder('Current password').fill(`${user.password}-wrong`)
  await expectModalEasedWhileRefused(page, modal, () => modal.getByRole('button', { name: 'Continue' }).click())
})
