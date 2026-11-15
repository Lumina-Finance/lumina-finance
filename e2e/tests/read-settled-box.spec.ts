import { expect, test, type Locator, type Page } from '@playwright/test'

import { createAccount, signUpUser, todayInTestTimezone } from '../support/api'
import { logInViaApi, openModal, openPage, readSettledBox } from '../support/app'

// Runs on desktop only: the entrances under test play the same way at every width

// A dialogue or popover mounts in its starting pose, and the motion library starts its entrance on the next
// frame. Holding the page's clock holds that frame, as a runner too busy to draw does, so the settled-box
// helper has to wait for the entrance to begin and end instead of taking the starting pose as the resting place

// A helper that takes the starting pose as settled returns after two reads one poll apart. Three polls of the
// same schedule outlast those two reads, so a helper still waiting after them is waiting for the entrance
const POLLS_PAST_TWO_READS = 3

// Pausing moves the page's clock forward to the pause, firing every timer due on the way, so the pause sits
// just ahead of the page's own time
const PAUSE_AHEAD_MS = 1_000

async function expectReadToWaitForEntrance(page: Page, opener: Locator, entering: Locator, element: Locator) {
  await page.clock.pauseAt(await page.evaluate((ahead) => Date.now() + ahead, PAUSE_AHEAD_MS))

  // Pressed from the page, since a paused clock stops the frames a click waits for
  await opener.evaluate((button: HTMLElement) => button.click())
  await expect(entering, 'the entrance starts from its starting pose').not.toHaveCSS('transform', 'none')

  let isRead = false
  const reading = readSettledBox(element).then((box) => {
    isRead = true
    return box
  })
  let polls = 0
  await expect.poll(() => ++polls).toBe(POLLS_PAST_TWO_READS)
  expect(isRead, 'no box is read while the entrance has not begun').toBe(false)
  await expect(entering, 'the held clock holds the entrance back').not.toHaveCSS('transform', 'none')

  await page.clock.resume()
  const box = await reading
  await expect(entering).toHaveCSS('transform', 'none')
  expect(box, 'the box read is the resting one').toEqual(await element.boundingBox())
}

// Reduced motion would leave out the slide and scale under test, and nothing here leaves the page, so the
// faked clock holding a fade back costs nothing
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.clock.install()
})

test('waits for a dialogue to finish entering before reading a field inside it', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings#categories')
  const dialog = page.getByRole('dialog', { name: 'Create category' })

  await expectReadToWaitForEntrance(
    page,
    page.locator('#categories').getByRole('button', { name: 'Create category', exact: true }),
    dialog,
    dialog.getByRole('textbox', { name: 'Category name', exact: true }),
  )
})

test('waits for the calendar to finish entering before reading a day in it', async ({ page, request }) => {
  const user = await signUpUser(request)
  await createAccount(request, user, { name: 'Everyday' })
  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  const dialog = await openModal(page, ['Add transaction'], 'Add transaction')
  const opener = dialog.getByRole('button', { name: 'Open calendar' })
  await readSettledBox(opener)
  const calendar = page.getByRole('dialog', { name: 'Choose date', exact: true })

  await expectReadToWaitForEntrance(page, opener, calendar, calendar.locator(`[data-iso="${todayInTestTimezone()}"]`))
})
