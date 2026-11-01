import { expect, test, type Locator } from '@playwright/test'

import { signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'

// Runs on desktop only: it sets every width it checks itself with page.setViewportSize

const EMOJI_DATA_URL = 'https://cdn.jsdelivr.net/npm/@emoji-mart/data'
const SIZES = [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]

async function readBox(locator: Locator) {
  return (await locator.boundingBox())!
}

// A failed emoji download once showed its reason in a floating note under the icon button, which
// covered the next section's title and the Category type label. The reason now takes its own room in the
// page, so everything the form draws stays visible and nothing overlaps it
for (const size of SIZES) {
  test(`keeps the form readable when the emoji list cannot load at ${size.width}px`, async ({ page, request }) => {
    await page.setViewportSize(size)
    const user = await signUpUser(request)
    await page.route(EMOJI_DATA_URL, (route) => route.abort('connectionfailed'))

    await logInViaApi(page, user)
    await openPage(page, '/settings#categories')
    await page.locator('#categories').getByRole('button', { name: 'Create category', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Create category' })
    const label = dialog.getByText('Category type', { exact: true })
    await expect(label).toBeVisible()
    // The dialog scales in as it opens, so positions are read once it has stopped moving
    await expect.poll(async () => {
      const first = await readBox(label)
      await page.waitForTimeout(250)
      const second = await readBox(label)
      return first.y === second.y
    }).toBe(true)
    const labelBefore = await readBox(label)

    await dialog.getByRole('button', { name: 'Select New category icon' }).click()
    const note = page.getByText("Couldn't reach the server. Please try again.", { exact: true })
    await expect(note).toBeVisible()
    await expect.poll(() => note.evaluate((node) => getComputedStyle(node).opacity)).toBe('1')

    // The note sits clear of the label and every other line of the form, and the picker is not left open
    await expect(page.getByRole('dialog', { name: 'Select New category icon' })).toHaveCount(0)
    const noteBox = await readBox(note)
    await expect.poll(async () => (await readBox(label)).y).toBeGreaterThanOrEqual(noteBox.y + noteBox.height)
    await expect(label).toBeVisible()
    const labelAfter = await readBox(label)
    expect(labelAfter.y, 'the label makes room instead of being covered').toBeGreaterThan(labelBefore.y)
    for (const text of ['Identity', 'Classification', 'Category type']) {
      const box = await readBox(dialog.getByText(text, { exact: true }))
      const overlap = Math.min(box.x + box.width, noteBox.x + noteBox.width) > Math.max(box.x, noteBox.x)
        && Math.min(box.y + box.height, noteBox.y + noteBox.height) > Math.max(box.y, noteBox.y)
      expect(overlap, `${text} is covered by the note`).toBe(false)
    }
    // The whole note stays on the screen
    expect(noteBox.x + noteBox.width).toBeLessThanOrEqual(size.width)
    // Screen readers are told about the failure as it appears
    await expect(page.getByRole('alert').filter({ has: note })).toHaveCount(1)
  })
}
