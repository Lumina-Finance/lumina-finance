import { expect, test, type Locator, type Page } from '@playwright/test'

import { createAccount, signUpUser } from '../support/api'
import { logInViaApi, openModal, openPage } from '../support/app'
import { expectPendingAction, whileApiRequestHeld } from '../support/selectors'

// Runs on desktop only: a phone's window fills the screen and leaves no dimmed page to press on. Every
// window is built on the one shared shell, so the Add account window stands for them all

const ACCOUNT_NAME = 'Everyday Chequing'

/** Distance in pixels from the window's edge to where a press lands on the dimmed page beside it */
const BACKDROP_OFFSET = 40

/**
 * Open the Add account window with a name typed in it.
 *
 * @param page - Page that has just signed in a new user
 * @returns The window and the field holding the name
 */
async function openAddAccountWindow(page: Page): Promise<{ dialog: Locator; nameField: Locator }> {
  await openPage(page, '/accounts')
  const dialog = await openModal(page, ['Add account'], 'Add account')
  const nameField = dialog.getByLabel('Account name')
  await nameField.fill(ACCOUNT_NAME)
  return { dialog, nameField }
}

/**
 * Find a point on the dimmed page beside the window, clear of every window
 *
 * @param panel - The open window
 * @returns Page coordinates of a point left of the window
 */
async function pointOnBackdrop(panel: Locator): Promise<{ x: number; y: number }> {
  const box = (await panel.boundingBox())!
  return { x: box.x - BACKDROP_OFFSET, y: box.y + box.height / 2 }
}

/**
 * Check a window is still open once the app has rendered what the last mouse event set off.
 *
 * A window that is closing stays on screen for its exit animation, so it is still visible just after it
 * was told to close. The page behind it stops being inert the moment it is told, so that tells a window
 * that stayed open from one that is on its way out.
 *
 * @param page - Page showing the window
 * @param panel - The window
 */
async function expectStillOpen(page: Page, panel: Locator): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  )
  await expect(page.locator('#root')).toHaveJSProperty('inert', true)
  await expect(panel).toBeVisible()
}

// A press that starts inside the window or ends inside it leaves the window open, and a plain click on the
// dimmed page closes it. The closing step comes last, since it closes the window the earlier steps share
test('closes a window only when the press and the release both land on the dimmed page', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  const { dialog, nameField } = await openAddAccountWindow(page)
  const outside = await pointOnBackdrop(dialog)

  await test.step('keeps it open when a press starts in it and is released on the dimmed page', async () => {
    // Selecting the name's text and letting go past the window's edge, as a person would
    const field = (await nameField.boundingBox())!
    await page.mouse.move(field.x + field.width - 4, field.y + field.height / 2)
    await page.mouse.down()
    await page.mouse.move(outside.x, outside.y, { steps: 8 })
    await page.mouse.up()

    await expectStillOpen(page, dialog)
    await expect(nameField).toHaveValue(ACCOUNT_NAME)
  })

  await test.step('keeps it open when a press starts on the dimmed page and is released in it', async () => {
    const heading = (await dialog.getByRole('heading', { name: 'Add account' }).boundingBox())!
    await page.mouse.move(outside.x, outside.y)
    await page.mouse.down()
    await page.mouse.move(heading.x + heading.width / 2, heading.y + heading.height / 2, { steps: 8 })
    await page.mouse.up()

    await expectStillOpen(page, dialog)
  })

  await test.step('closes it on a plain click on the dimmed page, after presses that began inside it', async () => {
    await page.mouse.click(outside.x, outside.y)

    await expect(dialog).toBeHidden()
  })
})

test('keeps a window open on a click on the dimmed page while it saves', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: ACCOUNT_NAME })
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  await page.getByRole('button', { name: 'Edit account', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit account', exact: true })
  await dialog.getByLabel('Account name').fill('Account after edit')
  const submit = dialog.getByTestId('account-submit')
  const outside = await pointOnBackdrop(dialog)

  await whileApiRequestHeld(
    page,
    'PATCH',
    `/accounts/${account.id}`,
    () => submit.click(),
    async () => {
      await expectPendingAction(submit, 'Save changes')
      await page.mouse.click(outside.x, outside.y)
      await expectStillOpen(page, dialog)
    },
  )
  await expect(dialog).toBeHidden()
})
