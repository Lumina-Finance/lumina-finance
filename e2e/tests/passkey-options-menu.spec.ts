/**
 * Guards the passkey card's options menu. The import rules list shares it. Opened the way the card has
 * always opened it, it leaves focus on its button, gives the arrow keys no work and carries no name or link
 * of its own, since only a list of rows turns those on
 */
import { expect, test } from '@playwright/test'

import { signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: the menu opens the same way at every size

test('opens the passkey options menu with focus left on its button and no arrow handling', async ({ page, request }) => {
  const user = await signUpUser(request)
  await page.route(`${API_BASE_URL}/auth/passkeys`, (route) =>
    route.fulfill({
      json: [{ id: 'laptop', name: 'Laptop', created_at: new Date().toISOString(), last_used_at: null }],
    }),
  )
  await logInViaApi(page, user)
  await openPage(page, '/settings#security')
  await page.locator('#security').getByRole('button', { name: 'Manage', exact: true }).click()

  const trigger = page.getByRole('button', { name: 'Options for Laptop', exact: true })
  await trigger.click()
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem')).toHaveText(['Rename', 'Remove'])
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect(trigger).not.toHaveAttribute('aria-controls')
  await expect(menu).not.toHaveAttribute('aria-label')
  await expect(menu).not.toHaveAttribute('id')

  // A list of rows moves focus to the first item a frame after opening, so two frames show it does not move here
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
  await expect(trigger).toBeFocused()

  // An arrow key moves nothing into the menu
  await page.keyboard.press('ArrowDown')
  await expect(trigger).toBeFocused()
  await expect(menu.getByRole('menuitem').first()).not.toBeFocused()
})
