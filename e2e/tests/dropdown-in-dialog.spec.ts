/**
 * Guards a dropdown's open list inside a dialog, which once covered the dialog's title or its buttons
 * because it was placed against the window rather than the dialog's own body
 */
import { expect, test, type Locator } from '@playwright/test'

import { createAccount, signUpUser } from '../support/api'
import { logInViaApi, openModal, openPage } from '../support/app'

for (const size of [{ width: 1280, height: 800 }, { width: 1920, height: 1080 }]) {
  test(`keeps the title and buttons of Add Transaction in view with Category open at ${size.width}x${size.height}`, async ({ page, request }) => {
    const user = await signUpUser(request)
    await createAccount(request, user, { name: 'Everyday Chequing' })
    await page.setViewportSize(size)
    // Reduced motion settles the dialog and the list at once, so where they sit is read where they stay
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await logInViaApi(page, user)
    await openPage(page, '/transactions')
    const dialog = await openModal(page, ['Add Transaction', 'Add transaction'], 'Add Transaction')

    const edges = [
      dialog.getByRole('heading', { name: 'Add Transaction', exact: true }),
      dialog.getByRole('button', { name: 'Cancel', exact: true }),
      dialog.getByRole('button', { name: 'Add Transaction', exact: true }),
    ]
    // The dialog's own entrance plays even with reduced motion, so its edges are read once they stop moving
    const edgeBoxes = () => Promise.all(edges.map((edge) => edge.boundingBox()))
    let closedAt = await edgeBoxes()
    await expect.poll(async () => {
      const previous = closedAt
      closedAt = await edgeBoxes()
      return JSON.stringify(closedAt) === JSON.stringify(previous)
    }).toBe(true)

    await dialog.getByRole('combobox', { name: 'Category', exact: true }).click()
    await expect(page.getByRole('option').first()).toBeVisible()
    for (const edge of edges) await expect.poll(() => isUncovered(edge)).toBe(true)
    // Still a list worth choosing from in the room left between them
    await expect(page.getByRole('option').nth(2)).toBeInViewport()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('option')).toHaveCount(0)
    // Closing leaves the dialog exactly as it was before the list opened
    expect(await edgeBoxes()).toEqual(closedAt)
  })
}

/**
 * Returns whether nothing is drawn over the element at its centre or near any of its four edges, so a
 * list covering only part of it still counts as covering it. The points stay clear of the corners,
 * which a pill button's rounding leaves outside the button
 */
async function isUncovered(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const middleX = box.left + box.width / 2
    const middleY = box.top + box.height / 2
    const inset = box.height / 2
    const points = [
      [middleX, middleY],
      [middleX, box.top + 2],
      [middleX, box.bottom - 2],
      [box.left + inset, middleY],
      [box.right - inset, middleY],
    ]
    return points.every(([x, y]) => {
      const shown = document.elementFromPoint(x, y)
      return shown !== null && element.contains(shown)
    })
  })
}
