import { expect, test, type Locator, type Page } from '@playwright/test'

import { signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { AT_EVERY_SIZE } from '../support/sizes'
import { API_BASE_URL } from '../support/target'

// Runs at every size: the message sits on the field's label row, which stacks differently on a phone, and the
// button is reached by tap there

/** Open the Create tag dialog from Settings, a dialog with one required field */
async function openCreateTag(page: Page): Promise<{ dialog: Locator; field: Locator; create: Locator }> {
  await openPage(page, '/settings#tags')
  await page.locator('#tags').getByRole('button', { name: 'Create tag', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create tag' })
  return {
    dialog,
    field: dialog.getByRole('textbox', { name: 'Tag name', exact: true }),
    create: dialog.getByRole('button', { name: 'Create', exact: true }),
  }
}

/** Count the requests that create a tag, to prove a refused press sent nothing */
function countTagCreations(page: Page): () => number {
  let count = 0
  page.on('request', (request) => {
    if (request.url() === `${API_BASE_URL}/tags` && request.method() === 'POST') count += 1
  })
  return () => count
}

test.describe('dialog input errors', () => {
  test('opens clickable, marks the field when a press finds it empty, and returns once it is filled', AT_EVERY_SIZE, async ({ page, request }) => {
    const user = await signUpUser(request)
    const creations = countTagCreations(page)
    await logInViaApi(page, user)
    const { dialog, field, create } = await openCreateTag(page)

    // Nothing is marked and the button is whole while the dialog is untouched
    await expect(create).not.toHaveAttribute('aria-disabled', 'true')
    await expect(dialog.getByRole('alert')).toHaveCount(0)

    await create.click()
    const message = dialog.getByRole('alert')
    await expect(message).toHaveText('Name is required')
    await expect(field).toHaveAttribute('aria-invalid', 'true')
    await expect(field).toHaveAccessibleDescription('Name is required')
    await expect(create).toHaveAttribute('aria-disabled', 'true')
    expect(creations()).toBe(0)

    // The message is on the field's label row, above the field and not down with the actions
    const [messageBox, fieldBox] = [await message.boundingBox(), await field.boundingBox()]
    expect(messageBox!.y + messageBox!.height).toBeLessThanOrEqual(fieldBox!.y)

    // Typing fixes the one problem, which clears the message at once and brings the button back
    await field.fill('Holiday')
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await expect(field).not.toHaveAttribute('aria-invalid', 'true')
    await expect(create).not.toHaveAttribute('aria-disabled', 'true')
  })

  test('keeps the faded button focusable and does nothing when it is pressed or Enter is pressed in the field', async ({ page, request }) => {
    const user = await signUpUser(request)
    const creations = countTagCreations(page)
    await logInViaApi(page, user)
    const { dialog, field, create } = await openCreateTag(page)

    // Enter in the empty field is a refused press too
    await field.press('Enter')
    await expect(dialog.getByRole('alert')).toHaveText('Name is required')
    await expect(create).toHaveAttribute('aria-disabled', 'true')
    // A refused press brings the first problem into focus a frame later, so wait for it before moving on
    await expect(field).toBeFocused()

    await create.focus()
    await expect(create).toBeFocused()
    await create.press('Enter')
    await field.press('Enter')
    await expect(create).toHaveAttribute('aria-disabled', 'true')
    expect(creations()).toBe(0)
  })
})
