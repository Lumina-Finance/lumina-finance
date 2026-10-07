/**
 * Guards names that scroll in their rows, which once showed blank when too long for the row because
 * the scrolling copy stayed hidden while the still copy was hidden for it
 */
import { expect, test, type Page } from '@playwright/test'

import { asUser, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

const LONG_NAME = 'The Extraordinarily Long Named Neighbourhood Artisan Bakery and Delicatessen Incorporated of Greater Springfield'
const SHORT_NAME = 'Corner Market'

/**
 * Reports whether the name was measured as too long for its row, and whether any copy of it on screen
 * is drawn. The name is rendered as a still copy, a scrolling copy and an off-screen measuring copy,
 * and a row that hides the first two looks blank. The measurement lands just after the first render,
 * so the drawn check counts only once it has
 */
async function nameState(page: Page, name: string): Promise<{ overflowing: boolean, drawn: boolean }> {
  return page.locator('#merchants').getByText(name, { exact: true }).evaluateAll((elements) => ({
    overflowing: elements.some((element) => element.closest('[data-overflow]')?.getAttribute('data-overflow') === 'true'),
    drawn: elements.some((element) => {
      const rect = element.getBoundingClientRect()
      return rect.left > -1000 && rect.width > 0 && getComputedStyle(element).opacity === '1'
    }),
  }))
}

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`shows a merchant name too long for its phone row with ${reducedMotion} motion`, async ({ page, request }) => {
    const user = await signUpUser(request)
    for (const name of [LONG_NAME, SHORT_NAME]) {
      const created = await request.post(`${API_BASE_URL}/merchants`, { headers: asUser(user), data: { name } })
      expect(created.status()).toBe(201)
    }

    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ reducedMotion })
    await logInViaApi(page, user)
    await openPage(page, '/settings#merchants')
    await expect(page.locator('#merchants').getByText(LONG_NAME, { exact: true }).first()).toBeAttached()

    await expect.poll(() => nameState(page, LONG_NAME)).toEqual({ overflowing: true, drawn: true })
    await expect.poll(() => nameState(page, SHORT_NAME)).toEqual({ overflowing: false, drawn: true })
  })
}
