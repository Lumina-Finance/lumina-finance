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
  // Records, for every frame as it will be drawn, how far the message's lower edge is above the
  // footer's top. A resize observer reports after every animation frame callback and layout, just
  // before the frame is drawn, so a box flipped in size each frame makes the observer read every drawn frame
  // rather than one caught partway through the page's own frame work. Only frames where the
  // footer reaches into the message's corner count, since only then is the message lifted
  await page.evaluate(() => {
    const store = window as unknown as { gaps: number[], footerTops: number[] }
    store.gaps = []
    store.footerTops = []
    const probe = document.createElement('div')
    probe.style.cssText = 'position: fixed; top: 0; left: 0; width: 1px; height: 1px; pointer-events: none'
    document.body.append(probe)
    new ResizeObserver(() => {
      const message = Array.from(document.querySelectorAll('[role="status"]')).find((node) => node.textContent?.includes('Import undone'))
      const footer = document.querySelector('[data-toast-keep-clear]')
      if (!message || !footer || Number(getComputedStyle(message).opacity) <= 0.9) return
      const cornerBottom = innerHeight - parseFloat(getComputedStyle(message).bottom)
      const footerTop = footer.getBoundingClientRect().top
      // The entrance slide is the card's `transform` and the lift is its separate `translate`, so taking
      // the slide's offset from the box read in this same frame leaves where the lift put the message
      const slide = new DOMMatrix(getComputedStyle(message).transform).m42
      if (footerTop < cornerBottom + 12) {
        store.gaps.push(footerTop - (message.getBoundingClientRect().bottom - slide))
        store.footerTops.push(footerTop)
      }
    }).observe(probe)
    const flip = () => {
      probe.style.width = probe.style.width === '1px' ? '2px' : '1px'
      requestAnimationFrame(flip)
    }
    flip()
  })
  await undoImport(page, 'mouse')
  await expect(page.getByRole('status').filter({ hasText: REOPENED_MESSAGE })).toBeVisible()
  const readGaps = () => page.evaluate(() => (window as unknown as { gaps: number[] }).gaps)
  await expect.poll(async () => (await readGaps()).at(-1)).toBeCloseTo(12, 0)

  // Scrolls the steps a few pixels at a time from timers, so each move lands between frames rather than
  // in step with them, and the footer moves under the message while it shows
  const scrolledTo = await page.getByRole('region', { name: 'Import steps' }).evaluate(async (steps) => {
    const STEP_PX = 4
    const STEPS = 10
    const positions = new Set<number>()
    for (const direction of [-1, 1]) {
      for (let step = 0; step < STEPS; step += 1) {
        steps.scrollTop += direction * STEP_PX
        positions.add(steps.scrollTop)
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return positions.size
  })
  const gaps = await readGaps()
  const footerTops = await page.evaluate(() => (window as unknown as { footerTops: number[] }).footerTops)

  // Without the steps actually moving, the frames read above would all be of a still footer
  expect(scrolledTo).toBeGreaterThan(5)
  // Counted by where the footer was drawn rather than by frames, since a slow runner draws fewer frames
  // of the same scroll and a still footer would read the same place in every frame it draws
  expect(new Set(footerTops.map((top) => top.toFixed(1))).size).toBeGreaterThan(5)
  // The footer moves under the message as the importer reopens and as the steps scroll, and the
  // message must be drawn at the footer's new place in the same frame, never a frame behind it
  expect(Math.max(...gaps.map((gap) => Math.abs(gap - 12)))).toBeLessThan(0.5)
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
    // The undone page puts focus on itself a frame after the undo, since the undo button went with the import. Focus
    // set before then is taken away again, so it is waited for. The undo dialogue's panel takes focus the same way,
    // so the dialogue is waited out first
    await expect(page.getByRole('dialog', { name: 'Undo this import?' })).toBeHidden()
    await expect(page.locator(':focus')).toHaveAttribute('tabindex', '-1')
    // Focus scrolls the button into view without knowing of the message
    await commit.focus()
    await expect(commit).toBeFocused()

    await expect.poll(isClearOfMessage(page, commit)).toBe(true)
    expect((await commitImport(page, { via: 'keyboard' })).status()).toBe(201)
  })
}
