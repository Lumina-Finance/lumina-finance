/**
 * Guards keyboard focus around the passkeys list's overflow menu in the Multi-factor authentication dialogue:
 * the menu once took no focus when opened with a key, its arrow keys did nothing, and choosing an item or
 * closing the menu by scroll, resize or the rename buttons dropped focus to the page
 */
import { expect, test, type Page } from '@playwright/test'

import { signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: the menu and its focus behave the same at every size

const PASSKEYS = ['Phone', 'Laptop'].map((name) => ({
  id: name,
  name,
  created_at: new Date().toISOString(),
  last_used_at: null,
}))

async function openPasskeyDialog(page: Page) {
  await page.route(`${API_BASE_URL}/auth/passkeys`, (route) => route.fulfill({ json: PASSKEYS }))
  await page.route(`${API_BASE_URL}/auth/passkeys/Phone`, (route) =>
    route.fulfill({ json: { ...PASSKEYS[0], name: 'Work phone' } }))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await logInViaApi(page, await signUpUser(page.request))
  await openPage(page, '/settings#security')
  await page.locator('#security').getByRole('button', { name: 'Manage', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Multi-factor authentication' })
  await expect(dialog.getByText('Phone', { exact: true })).toBeVisible()
  return dialog
}

/**
 * Focus can scroll the dialogue body to a button, and the scroll event arrives a frame later. Any scroll closes the
 * menu, so this waits two frames for that event to pass before a test opens the menu
 */
async function waitForFocusScroll(page: Page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

/**
 * Puts focus on a passkey's Options button, where a keyboard user presses Enter to open its menu
 */
async function focusOptions(page: Page, name: string) {
  const options = page.getByRole('button', { name: `Options for ${name}` })
  await options.focus()
  await expect(options).toBeFocused()
  await waitForFocusScroll(page)
  return options
}

test('opens with focus on the first item, moves with the arrow keys and returns focus on Escape', async ({ page }) => {
  await openPasskeyDialog(page)
  const options = await focusOptions(page, 'Phone')

  await page.keyboard.press('Enter')
  await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeFocused()

  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitem', { name: 'Remove' })).toBeFocused()

  // Escape closes the menu alone and leaves the dialogue it sits in open
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toBeHidden()
  await expect(options).toBeFocused()
  await expect(page.getByRole('dialog', { name: 'Multi-factor authentication' })).toBeVisible()
})

test('closes on Tab and carries on from the button, not from the end of the page', async ({ page }) => {
  await openPasskeyDialog(page)
  const options = await focusOptions(page, 'Phone')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeFocused()

  await page.keyboard.press('Tab')
  await expect(page.getByRole('menu')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Options for Laptop' })).toBeFocused()
  await expect(options).not.toBeFocused()
})

test('opens with a mouse press without moving focus onto an item', async ({ page }) => {
  await openPasskeyDialog(page)
  await page.getByRole('button', { name: 'Options for Phone' }).click()

  await expect(page.getByRole('menu')).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Rename' })).not.toBeFocused()
})

test('returns focus to the button after the removal dialogue is dismissed', async ({ page }) => {
  await openPasskeyDialog(page)
  const options = await focusOptions(page, 'Phone')
  await page.keyboard.press('Enter')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')

  const removal = page.getByRole('dialog', { name: 'Remove this passkey' })
  await expect(removal).toBeVisible()
  // The dialogue leaves Escape to the menu while the menu is still fading out
  await expect(page.getByRole('menu')).toBeHidden()
  await page.keyboard.press('Escape')
  await expect(removal).toBeHidden()
  await expect(options).toBeFocused()
})

test('returns focus to the button after the rename ends by Save, Cancel or Escape', async ({ page }) => {
  await openPasskeyDialog(page)

  for (const end of ['Cancel rename', 'Escape', 'Save name'] as const) {
    const name = end === 'Save name' ? 'Phone' : 'Laptop'
    await focusOptions(page, name)
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    const field = page.getByLabel('Passkey name')
    await expect(field).toBeFocused()

    if (end === 'Escape') {
      await page.keyboard.press('Escape')
    } else {
      await page.getByRole('button', { name: end }).click()
    }

    await expect(field).toBeHidden()
    await expect(page.getByRole('button', { name: `Options for ${name}` })).toBeFocused()
    // The dialogue stays open when Escape only ends the rename
    await expect(page.getByRole('dialog', { name: 'Multi-factor authentication' })).toBeVisible()
  }
})

test('returns focus to the button after a press on bare dialogue, and leaves a control that takes the press alone', async ({ page }) => {
  const dialog = await openPasskeyDialog(page)
  const options = await focusOptions(page, 'Phone')

  await page.keyboard.press('Enter')
  await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeFocused()
  await dialog.getByRole('heading', { name: 'Passkeys' }).click()
  await expect(page.getByRole('menu')).toBeHidden()
  await expect(options).toBeFocused()

  await page.keyboard.press('Enter')
  await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeFocused()
  const add = dialog.getByRole('button', { name: 'Add passkey' })
  await add.click()
  await expect(page.getByRole('menu')).toBeHidden()
  await expect(dialog.getByLabel('New passkey name')).toBeFocused()
})

test('returns focus to the button when a scroll or resize closes the menu, and leaves a field elsewhere alone', async ({ page }) => {
  await openPasskeyDialog(page)
  const options = await focusOptions(page, 'Phone')

  await page.keyboard.press('Enter')
  await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeFocused()
  await page.evaluate(() => window.dispatchEvent(new Event('scroll')))
  await expect(page.getByRole('menu')).toBeHidden()
  await expect(options).toBeFocused()

  await page.keyboard.press('Enter')
  await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeFocused()
  await page.setViewportSize({ width: 1100, height: 800 })
  await expect(page.getByRole('menu')).toBeHidden()
  await expect(options).toBeFocused()

  // With focus in a field outside the menu, the same scroll closes the menu and keeps focus where it is
  await page.getByRole('button', { name: 'Add passkey' }).click()
  const field = page.getByLabel('New passkey name')
  await expect(field).toBeFocused()
  await options.focus()
  await waitForFocusScroll(page)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeFocused()
  await field.focus()
  await expect(page.getByRole('menu')).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event('scroll')))
  await expect(page.getByRole('menu')).toBeHidden()
  await expect(field).toBeFocused()
})
