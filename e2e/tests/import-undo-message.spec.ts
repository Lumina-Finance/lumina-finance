import { expect, test, type Locator, type Page } from '@playwright/test'

import { commitImport, openPage } from '../support/app'
import { finishImport, undoImport, UNDO_SIZES } from '../support/import-undo'

// Runs on desktop only: each test sets the widths it checks itself

const REOPENED_MESSAGE = 'Import undone. Your files and answers are back, so you can change anything and import again.'

/**
 * Whether the button is on screen with the pointer's target at its middle and every corner being the
 * button itself, and the message showing is clear of it. False once the message has gone, so a
 * button uncovered only because the message timed out never passes
 */
function isClearOfMessage(page: Page, button: Locator) {
  return async () => {
    const message = page.getByRole('status').filter({ hasText: 'Import undone' })
    if (!await message.isVisible()) return false
    const messageBox = await message.boundingBox()
    return button.evaluate((node, toast) => {
      const rect = node.getBoundingClientRect()
      const inView = rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth
      const points = [
        [rect.left + rect.width / 2, rect.top + rect.height / 2],
        // Inside the pill's rounded corners, which are 20px across
        [rect.left + 8, rect.top + 8],
        [rect.right - 8, rect.top + 8],
        [rect.left + 8, rect.bottom - 8],
        [rect.right - 8, rect.bottom - 8],
      ]
      const isHit = points.every(([x, y]) => node.contains(document.elementFromPoint(x, y)))
      const overlaps = toast !== null && rect.left < toast.x + toast.width && rect.right > toast.x
        && rect.top < toast.y + toast.height && rect.bottom > toast.y
      return inView && isHit && !overlaps
    }, messageBox)
  }
}

test('keeps the upload area clear of the Import undone message when no files are staged at 390x844', async ({ page, request }) => {
  await finishImport(page, request, { width: 390, height: 844 })
  // Opened afresh, so the importer starts empty and the message asks for the files again
  await openPage(page, page.url())
  await undoImport(page, 'mouse')

  await expect(page.getByRole('status').filter({ hasText: 'Import undone. Upload the files again to import them.' })).toBeVisible()
  const upload = page.getByRole('button', { name: /^Upload CSV file/ })
  // Its lower edge at the bottom of the window, where the message sits
  await upload.evaluate((node) => node.scrollIntoView({ block: 'end' }))

  await expect.poll(isClearOfMessage(page, upload)).toBe(true)
})

test('keeps the Import undone message the same gap above the footer while the page settles after an undo', async ({ page, request }) => {
  await finishImport(page, request, UNDO_SIZES[0])
  // Records, on every frame, how far the message's lower edge is above the footer's top
  await page.evaluate(() => {
    const store = window as unknown as { gaps: number[] }
    store.gaps = []
    const tick = () => {
      const message = Array.from(document.querySelectorAll('[role="status"]')).find((node) => node.textContent?.includes('Import undone'))
      const footer = document.querySelector('[data-toast-keep-clear]')
      if (message && footer && Number(getComputedStyle(message).opacity) > 0.9) {
        store.gaps.push(footer.getBoundingClientRect().top - message.getBoundingClientRect().bottom)
      }
      requestAnimationFrame(tick)
    }
    tick()
  })
  await undoImport(page, 'mouse')
  await expect(page.getByRole('status').filter({ hasText: REOPENED_MESSAGE })).toBeVisible()
  await page.waitForTimeout(2000)
  const gaps = await page.evaluate(() => (window as unknown as { gaps: number[] }).gaps)

  expect(gaps.length).toBeGreaterThan(20)
  // The footer moves under the message as the importer reopens, and the message must follow it at
  // once rather than easing after it, which leaves it too high for a moment before it comes back
  expect(Math.max(...gaps)).toBeLessThanOrEqual(12.5)
  expect(gaps.at(-1)).toBeCloseTo(12, 0)
})

for (const size of UNDO_SIZES) {
  test(`keeps Commit import clear of the Import undone message at ${size.width}x${size.height}, for a mouse`, async ({ page, request }) => {
    await finishImport(page, request, size)
    await undoImport(page, 'mouse')

    const message = page.getByRole('status').filter({ hasText: REOPENED_MESSAGE })
    await expect(message).toBeVisible()
    const commit = page.getByRole('button', { name: 'Commit import', exact: true })
    await expect(commit).toBeEnabled()
    await commit.scrollIntoViewIfNeeded()

    // Polled while the message shows, since it moves out of the way over a moment
    await expect.poll(isClearOfMessage(page, commit)).toBe(true)
    await expect(message).toBeVisible()
    expect((await commitImport(page)).status()).toBe(201)
  })

  test(`keeps Commit import clear of the Import undone message at ${size.width}x${size.height}, for a keyboard`, async ({ page, request }) => {
    await finishImport(page, request, size)
    await undoImport(page, 'keyboard')

    await expect(page.getByRole('status').filter({ hasText: REOPENED_MESSAGE })).toBeVisible()
    const commit = page.getByRole('button', { name: 'Commit import', exact: true })
    await expect(commit).toBeEnabled()
    // Focus scrolls the button into view without knowing of the message
    await commit.focus()
    await expect(commit).toBeFocused()

    await expect.poll(isClearOfMessage(page, commit)).toBe(true)
    expect((await commitImport(page, { via: 'keyboard' })).status()).toBe(201)
  })
}
