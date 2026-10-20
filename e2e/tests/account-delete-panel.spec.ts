import { expect, test, type Locator, type Page } from '@playwright/test'

import { asUser, createAccount, createTransaction, signUpUser } from '../support/api'
import { logInViaApi, openPage, readScrollingBox, readSettledScrollingBox, roomBelow } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: the test that depends on the screen sets each size it checks itself

/**
 * Guards the delete confirmation in the account edit dialog. It opens at the foot of the dialog's
 * scrolling body, which used to stay where it was, so on a phone the panel opened out of sight. The
 * trash button that opens it and the Continue button that leads on are both gone once pressed, and
 * focus used to fall to the page each time
 */

const ACCOUNT_NAME = 'Everyday'

// On a tablet the dialog has room for the panel under the Identity, Details and Archive sections, and
// on a phone those sections fill it, so the panel opens below what it shows. The last size is the one
// the typed-name step is checked at
const DIALOG_SIZES = [
  { width: 768, height: 1024, hasRoom: true },
  { width: 390, height: 844, hasRoom: false },
  { width: 390, height: 667, hasRoom: false },
]

/** Open the account's edit dialog */
async function openEditDialog(page: Page, accountId: string) {
  await openPage(page, `/accounts/${accountId}`)
  await page.getByRole('button', { name: 'Edit account', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit account', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

/** Press the dialog's trash button from the keyboard */
async function pressTrash(dialog: Locator) {
  const trash = dialog.getByRole('button', { name: 'Delete account', exact: true })
  await trash.focus()
  await trash.press('Enter')
}

/** Wait until the control and everything around it have faded all the way in */
async function waitForFadeIn(control: Locator) {
  await expect.poll(() => control.evaluate((element) => {
    for (let node: Element | null = element; node; node = node.parentElement) {
      if (getComputedStyle(node).opacity !== '1') return false
    }
    return true
  })).toBe(true)
}

test('brings the delete confirmation into view and moves focus through its steps', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: ACCOUNT_NAME })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -5000 })
  await logInViaApi(page, user)

  for (const { hasRoom, ...size } of DIALOG_SIZES) {
    const at = `${size.width}×${size.height}`
    await page.setViewportSize(size)
    const dialog = await openEditDialog(page, account.id)
    const firstField = dialog.getByLabel('Account name', { exact: true })
    const before = await readScrollingBox(firstField)
    await pressTrash(dialog)

    const question = dialog.getByText(`Delete ${ACCOUNT_NAME}?`, { exact: true })
    const archiveInstead = dialog.getByRole('button', { name: 'Archive instead', exact: true })
    const continueButton = dialog.getByRole('button', { name: 'Continue', exact: true })
    await waitForFadeIn(continueButton)

    // Where the panel opened: past the end of what the body showed before the press on a phone, and
    // inside it with room
    const opened = await readScrollingBox(continueButton)
    const shownEnd = before.top + opened.clientHeight
    if (hasRoom) expect.soft(opened.elementBottom, `panel start at ${at}`).toBeLessThanOrEqual(shownEnd)
    else expect.soft(opened.elementBottom, `panel start at ${at}`).toBeGreaterThan(shownEnd)

    await expect.soft(archiveInstead, `focus at ${at}`).toBeFocused()
    // Named by its question, so moving into it announces what is being asked
    const panel = dialog.getByRole('group', { name: `Delete ${ACCOUNT_NAME}?`, exact: true })
    await expect.soft(panel, `panel name at ${at}`).toBeVisible()
    // The body it scrolls in ends at the footer, so what is under the footer is cut off and not on screen
    await expect.soft(question, `question at ${at}`).toBeInViewport({ ratio: 1 })
    await expect.soft(archiveInstead, `Archive instead at ${at}`).toBeInViewport({ ratio: 1 })
    await expect.soft(continueButton, `Continue at ${at}`).toBeInViewport({ ratio: 1 })
    // With room for the panel, the body stays where it was. Without it, the body's own bottom padding
    // still shows below the panel once the scroll ends, so the panel never sits flush on the footer
    if (hasRoom) expect.soft((await readScrollingBox(firstField)).top, `scroll at ${at}`).toBe(before.top)
    else {
      const settled = await readSettledScrollingBox(panel)
      expect.soft(roomBelow(settled), `room below the panel at ${at}`).toBeGreaterThanOrEqual(settled.paddingBottom)
    }
  }

  const dialog = page.getByRole('dialog', { name: 'Edit account', exact: true })
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Continue', exact: true })).toBeFocused()

  // The body is scrolled to its end, so the taller typed-name step grows in below what it shows
  // Polled, since the body may still be scrolling smoothly to the panel
  const question = dialog.getByText(`Delete ${ACCOUNT_NAME}?`, { exact: true })
  await expect.poll(async () => {
    const { remaining, paddingBottom } = await readScrollingBox(question)
    return remaining <= paddingBottom + 1
  }).toBe(true)

  await page.keyboard.press('Enter')
  const confirmation = dialog.getByLabel(`Type "${ACCOUNT_NAME}" to delete.`, { exact: true })
  await expect(confirmation).toBeFocused()
  await expect(dialog.getByText(`Type "${ACCOUNT_NAME}" to delete.`, { exact: true })).toBeInViewport({ ratio: 1 })
  await expect(confirmation).toBeInViewport({ ratio: 1 })
  const typedNamePanel = await readSettledScrollingBox(dialog.getByRole('group', { name: `Delete ${ACCOUNT_NAME}?`, exact: true }))
  expect(roomBelow(typedNamePanel), 'room below the panel after Continue').toBeGreaterThanOrEqual(typedNamePanel.paddingBottom)
  const enabledDelete = dialog.getByRole('button', { name: 'Delete account', exact: true, disabled: false })
  await expect(enabledDelete).toHaveCount(0)
  await page.keyboard.type(ACCOUNT_NAME)
  await expect(enabledDelete).toBeVisible()
})

test('focuses Continue when the account is already archived', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: ACCOUNT_NAME })
  const archived = await request.patch(`${API_BASE_URL}/accounts/${account.id}`, {
    headers: asUser(user),
    data: { is_archived: true },
  })
  expect(archived.status()).toBe(200)
  await logInViaApi(page, user)

  const dialog = await openEditDialog(page, account.id)
  await pressTrash(dialog)

  await expect(dialog.getByRole('button', { name: 'Continue', exact: true })).toBeFocused()
  await expect(dialog.getByRole('button', { name: 'Archive instead', exact: true })).toHaveCount(0)
})

// "Archive instead" leaves with the panel, so focus would fall to the page with it
test('moves focus to the archive switch after archiving instead', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: ACCOUNT_NAME })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -5000 })
  await logInViaApi(page, user)

  const dialog = await openEditDialog(page, account.id)
  await pressTrash(dialog)
  await expect(dialog.getByRole('button', { name: 'Archive instead', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')

  const archiveSwitch = dialog.getByRole('switch')
  await expect(archiveSwitch).toBeChecked()
  await expect(dialog.getByText(`Delete ${ACCOUNT_NAME}?`, { exact: true })).toHaveCount(0)
  await expect(archiveSwitch).toBeFocused()
  await expect(dialog.getByRole('alert')).toBeVisible()

  // Tab carries on from the switch to the footer, rather than starting again at the first field
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Delete account', exact: true })).toBeFocused()
  await expect(dialog).toBeVisible()
})

// The panel's own end of animation runs once more as it leaves, which must not pull focus into it
test('leaves focus on the archive switch when turning it on closes the delete confirmation', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: ACCOUNT_NAME })
  await logInViaApi(page, user)

  const dialog = await openEditDialog(page, account.id)
  await pressTrash(dialog)
  await expect(dialog.getByRole('button', { name: 'Archive instead', exact: true })).toBeFocused()

  const archiveSwitch = dialog.getByRole('switch')
  await archiveSwitch.focus()
  await archiveSwitch.press('Space')
  await expect(archiveSwitch).toBeChecked()
  await expect(dialog.getByText(`Delete ${ACCOUNT_NAME}?`, { exact: true })).toHaveCount(0)

  await expect(archiveSwitch).toBeFocused()
})

/** Within a pixel, since the layout's widths are fractions */
function expectNear(actual: number | undefined, expected: number | undefined, message: string) {
  expect(Math.abs(actual! - expected!), `${message}: ${actual} against ${expected}`).toBeLessThanOrEqual(1)
}

// The numbered sections keep their content in a column beside the step numbers, which the panel at the
// foot of the body and the save error above it must share, or their left edges sit level with the numbers
test('lines the delete confirmation and the save error up with the sections above them', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: ACCOUNT_NAME })
  await logInViaApi(page, user)
  // Every save fails, which puts the error line in the dialog
  await page.route('**/accounts/*', (route) => (
    route.request().method() === 'GET' ? route.fallback() : route.fulfill({ status: 500, json: { detail: 'Could not save.' } })
  ))

  for (const size of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const at = `${size.width}×${size.height}`
    await page.setViewportSize(size)
    const dialog = await openEditDialog(page, account.id)
    const archiveBox = dialog.locator('label').filter({ hasText: 'Archive account' })
    const panel = dialog.getByRole('group', { name: `Delete ${ACCOUNT_NAME}?`, exact: true })

    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click()
    const saveError = dialog.locator('p[style*="--app-negative"]')
    await expect(saveError).toBeVisible()
    const sections = await archiveBox.boundingBox()
    expect(sections, `Archive account box at ${at}`).not.toBeNull()
    await expect.poll(async () => Math.abs((await saveError.boundingBox())!.x - sections!.x), `save error left edge at ${at}`).toBeLessThanOrEqual(1)

    await pressTrash(dialog)
    const continueButton = dialog.getByRole('button', { name: 'Continue', exact: true })
    await waitForFadeIn(continueButton)
    await expect.poll(async () => Math.abs((await panel.boundingBox())!.x - sections!.x), `panel left edge at ${at}`).toBeLessThanOrEqual(1)
    expectNear((await panel.boundingBox())?.width, sections?.width, `panel width at ${at}`)

    await continueButton.click()
    const nameField = dialog.getByLabel(`Type "${ACCOUNT_NAME}" to delete.`, { exact: true })
    await expect(nameField).toBeVisible()
    await expect.poll(async () => Math.abs((await panel.boundingBox())!.x - sections!.x), `typed-name panel left edge at ${at}`).toBeLessThanOrEqual(1)
    expectNear((await panel.boundingBox())?.width, sections?.width, `typed-name panel width at ${at}`)

    await page.keyboard.press('Escape')
  }
})
