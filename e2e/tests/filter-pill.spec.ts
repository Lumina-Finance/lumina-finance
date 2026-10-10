import { expect, test, type Locator, type Page } from '@playwright/test'

import { createAccount, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'

/**
 * Guards the desktop Filters pill on both lists that carry it. Its press animation used to put a
 * second, silent Tab stop on its frame, and its closed panel stayed in the Tab order at no height
 */

const LISTS = [
  { name: 'transactions', path: '/transactions', filters: 'Transaction filters' },
  { name: 'accounts', path: '/accounts', filters: 'Account filters' },
] as const

async function openList(page: Page, request: Parameters<typeof signUpUser>[0], path: string) {
  const user = await signUpUser(request)
  await createAccount(request, user, { name: 'Everyday' })
  await logInViaApi(page, user)
  await openPage(page, path)
}

/** Whether focus sits inside the pill's glass, frame and panel included */
function focusIsInside(glass: Locator) {
  return glass.evaluate((node) => node.contains(document.activeElement))
}

for (const list of LISTS) {
  test.describe(`the Filters pill on ${list.name}`, () => {
    test.beforeEach(({ page }) => {
      test.skip(page.viewportSize()!.width < 750, 'The phone toolbar opens a sheet rather than the pill')
    })

    // Motion on, since the press animation is what made the frame a stop
    test('is one Tab stop, on its button', async ({ page, request }) => {
      await openList(page, request, list.path)
      const pill = page.getByRole('button', { name: list.filters, exact: true })
      const glass = page.locator('.app-range-glass').filter({ has: pill })

      await pill.focus()
      await page.keyboard.press('Shift+Tab')
      expect(await focusIsInside(glass)).toBe(false)
      await page.keyboard.press('Tab')
      await expect(pill).toBeFocused()
    })

    // Motion on, so focus is handed back while the panel is still closing
    test('keeps its closed panel out of the Tab order', async ({ page, request }) => {
      await openList(page, request, list.path)
      const pill = page.getByRole('button', { name: list.filters, exact: true })
      const glass = page.locator('.app-range-glass').filter({ has: pill })

      await pill.focus()
      await page.keyboard.press('Tab')
      expect(await focusIsInside(glass)).toBe(false)

      await pill.press('Enter')
      await page.keyboard.press('Tab')
      await expect(glass.getByRole('tab').first()).toBeFocused()

      await page.keyboard.press('Escape')
      await expect(pill).toHaveAttribute('aria-expanded', 'false')
      await expect(pill).toBeFocused()
      await page.keyboard.press('Tab')
      expect(await focusIsInside(glass)).toBe(false)
    })
  })
}
