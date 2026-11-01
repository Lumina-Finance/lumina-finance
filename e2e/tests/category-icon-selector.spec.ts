import { expect, test, type Page } from '@playwright/test'

import { signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'

// Runs on desktop only: it sets the one width it checks itself with page.setViewportSize

async function openPicker(page: Page, request: Parameters<typeof signUpUser>[0]) {
  await page.setViewportSize({ width: 1280, height: 800 })
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings#categories')
  await page.locator('#categories').getByRole('button', { name: 'Create category', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create category' })
  const button = dialog.getByRole('button', { name: 'Select New category icon' })
  await button.click()
  const panel = page.getByRole('dialog', { name: 'Select New category icon' })
  await expect(panel.getByRole('searchbox')).toBeVisible({ timeout: 15000 })
  return { dialog, button, panel }
}

test('closes the emoji panel on Escape and leaves the form open', async ({ page, request }) => {
  const { dialog, panel } = await openPicker(page, request)

  await page.keyboard.press('Escape')

  await expect(panel).toHaveCount(0)
  await expect(dialog).toBeVisible()
})

test('closes the emoji panel on a press elsewhere in the form', async ({ page, request }) => {
  const { dialog, panel } = await openPicker(page, request)

  await dialog.getByText('Identity', { exact: true }).click()

  await expect(panel).toHaveCount(0)
  await expect(dialog).toBeVisible()
})

test('shows the picked emoji on the icon button and closes the panel', async ({ page, request }) => {
  const { button, panel } = await openPicker(page, request)
  await panel.getByRole('searchbox').fill('red heart')
  const choice = panel.getByRole('button', { name: '❤️', exact: true })
  await expect(choice).toBeVisible()

  await choice.click()

  await expect(panel).toHaveCount(0)
  await expect(button).toHaveText('❤️')
})

test('shrinks the emoji panel when a search has few results and grows it back when cleared', async ({ page, request }) => {
  const { panel } = await openPicker(page, request)
  const height = async () => (await panel.boundingBox())!.height
  const full = await height()
  const search = panel.getByRole('searchbox')

  await search.fill('red heart')
  await expect.poll(height).toBeLessThan(full - 50)

  await search.fill('')
  await expect.poll(height).toBeGreaterThan(full - 2)
})

test('returns focus to the icon button after Escape, so a second Escape leaves the dialogue open', async ({
  page,
  request,
}) => {
  const { dialog, button, panel } = await openPicker(page, request)
  await panel.getByRole('searchbox').click()
  await expect(panel.getByRole('searchbox')).toBeFocused()

  await page.keyboard.press('Escape')

  await expect(panel).toHaveCount(0)
  await expect(button).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
})

test('returns focus to the icon button after a pick', async ({ page, request }) => {
  const { button, panel } = await openPicker(page, request)
  await panel.getByRole('searchbox').fill('red heart')
  const choice = panel.getByRole('button', { name: '❤️', exact: true })
  await expect(choice).toBeVisible()

  await choice.click()

  await expect(panel).toHaveCount(0)
  await expect(button).toBeFocused()
})

test('returns the panel to its content height when the button is pressed while it folds away', async ({
  page,
  request,
}) => {
  const { button, panel } = await openPicker(page, request)
  const height = async () => (await panel.boundingBox())?.height ?? 0
  const full = await height()
  expect(full).toBeGreaterThan(200)

  // Presses Escape and then the button inside the 200ms the panel takes to fold, which a driven click can't be sure of
  await button.evaluate(async (element) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await new Promise((resolve) => setTimeout(resolve, 60))
    ;(element as HTMLButtonElement).click()
  })

  await expect(button).toHaveAttribute('aria-expanded', 'true')
  await expect(panel.getByRole('searchbox')).toBeVisible()
  await expect.poll(height).toBeGreaterThan(full - 2)
})
