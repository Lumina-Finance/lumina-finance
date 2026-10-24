import { expect, test, type APIRequestContext, type Locator, type Page, type Request } from '@playwright/test'

import { createAccount, createTransaction, daysFromTodayInTestTimezone, signUpUser } from '../support/api'
import { logInViaApi, openModal, openPage } from '../support/app'

// Runs on desktop only, except the tap test, which sets up a touch screen of its own. A control held off
// for a reason does nothing when it is clicked, tabbed to or pressed with Enter, and says why instead

const NOTHING_CHOSEN = 'Choose a change to apply'
const FIX_FIELDS = 'Fix the fields with errors first'
const TOOLTIP = 'disabled-reason-tooltip'

/** Opens the bulk edit window over one ticked transaction, with nothing chosen to change yet */
async function openBulkEdit(page: Page, request: APIRequestContext) {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -1000, date: daysFromTodayInTestTimezone(-1) })
  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  await page.getByRole('button', { name: 'Select transactions', exact: true }).click()
  await page.getByRole('checkbox', { name: /^Select the transactions shown on / }).first().check()
  await page.getByRole('button', { name: 'Edit the selected transactions', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit 1 transaction', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

/** Opens the bulk edit window and presses Apply once with nothing chosen, which fades it with its reason */
async function openRefusedBulkEdit(page: Page, request: APIRequestContext) {
  const dialog = await openBulkEdit(page, request)
  const apply = dialog.getByRole('button', { name: 'Apply', exact: true })
  await apply.click()
  await expect(apply).toHaveAttribute('aria-disabled', 'true')
  return dialog
}

/** Expects the tooltip to be faded out, or gone from the page once its fade has ended */
async function expectFadedOut(tooltip: Locator) {
  await expect.poll(() => tooltip.evaluateAll((nodes) => nodes.every((node) => getComputedStyle(node).opacity === '0'))).toBe(true)
}

/** Records every request the page sends to a path, to be read after a request that must have been seen */
function recordRequests(page: Page, method: string, path: RegExp) {
  const sent: Request[] = []
  page.on('request', (request) => {
    if (request.method() === method && path.test(new URL(request.url()).pathname)) sent.push(request)
  })
  return sent
}

test('does nothing when Apply is pressed with nothing chosen, and applies once something is', async ({ page, request }) => {
  const dialog = await openBulkEdit(page, request)
  const apply = dialog.getByRole('button', { name: 'Apply', exact: true })
  const bulkRequests = recordRequests(page, 'PATCH', /\/transactions\/bulk$/)

  // Apply is whole until it is pressed, then it marks the missing change and holds itself off
  await expect(apply).not.toHaveAttribute('aria-disabled', 'true')
  await apply.click()
  await expect(apply).toHaveAttribute('aria-disabled', 'true')
  await expect(apply).toHaveAccessibleDescription(NOTHING_CHOSEN)

  // toBeDisabled passes for aria-disabled, so the press itself is made: a click, then Enter and Space
  // on the focused button. The click is forced past the check that the button is enabled
  await apply.click({ force: true })
  await apply.focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Space')
  await expect(dialog).toBeVisible()
  const confirmation = page.getByRole('dialog', { name: 'Change 1 transaction?', exact: true })
  await expect(confirmation).toHaveCount(0)

  // The fence: a real Apply goes through once a change is chosen, and only it was ever sent. A request
  // from the presses above would have been sent before this one and would be counted with it
  await dialog.locator('#bulk-note').fill('Corrected')
  await expect(apply).not.toHaveAttribute('aria-disabled', 'true')
  await apply.click()
  await expect(confirmation).toBeVisible()
  const applied = page.waitForResponse((response) => response.request().method() === 'PATCH' && /\/transactions\/bulk$/.test(new URL(response.url()).pathname))
  await confirmation.getByRole('button', { name: 'Confirm', exact: true }).click()
  expect((await applied).ok()).toBe(true)
  expect(bulkRequests).toHaveLength(1)
  await expect(dialog).toBeHidden()
})

test('sends nothing when a sign-up with a refused field is submitted by click or Enter', async ({ page }) => {
  // Only the sign-up request ends in this path, since the confirmation one continues past it
  const signupRequests = recordRequests(page, 'POST', /\/signup$/)
  const email = `e2e-${crypto.randomUUID()}@example.com`
  await page.goto('/signup')
  await page.getByLabel('First name').fill('Test')
  await page.getByLabel('Email').fill('not-an-email')
  await page.getByLabel('Last name').fill('User')
  const submit = page.getByRole('button', { name: 'Sign up', exact: true })
  // Leaving the email for the next field checks it, finds it wrong and holds the button off
  await expect(page.getByText('Enter a valid email address', { exact: true })).toBeVisible()
  await expect(submit).toHaveAttribute('aria-disabled', 'true')
  await expect(submit).toHaveAccessibleDescription(FIX_FIELDS)

  await submit.click({ force: true })
  await page.getByLabel('Email').press('Enter')
  await submit.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/signup$/)

  // The fence: with the email put right the same button signs up, and that one request is all that was sent
  await page.getByLabel('Email').fill(email)
  await expect(submit).not.toHaveAttribute('aria-disabled', 'true')
  const signedUp = page.waitForResponse((response) => response.request().method() === 'POST' && /\/signup$/.test(new URL(response.url()).pathname))
  await submit.click()
  expect((await signedUp).status()).toBe(204)
  expect(signupRequests).toHaveLength(1)
})

test('saves nothing when Settings Save is pressed with no changes, and saves once there is one', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings')
  const profileRequests = recordRequests(page, 'PATCH', /\/me$/)
  // Every settings pane has its own Save, so this one is the profile pane's
  const save = page.locator('#profile').getByRole('button', { name: 'Save', exact: true })

  await expect(save).toHaveAttribute('aria-disabled', 'true')
  await expect(save).toHaveAccessibleDescription('There are no changes to save')

  await save.click({ force: true })
  await save.focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Space')

  // The fence: a real Save goes through once the name changes, and only it was ever sent
  await page.getByLabel('First name').fill('Renamed')
  await expect(save).not.toHaveAttribute('aria-disabled', 'true')
  const saved = page.waitForResponse((response) => response.request().method() === 'PATCH' && /\/me$/.test(new URL(response.url()).pathname))
  await save.click()
  expect((await saved).ok()).toBe(true)
  expect(profileRequests).toHaveLength(1)
})

test('opens nothing when a dropdown held off for a reason is clicked or Enter is pressed', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  const dialog = await openModal(page, ['Add transaction'], 'Add transaction')
  const currency = dialog.locator('#txn-currency')

  await expect(currency).toHaveAttribute('aria-disabled', 'true')
  await expect(currency).toHaveAccessibleDescription("Locked to the selected account's currency")

  await currency.click({ force: true })
  await currency.focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('ArrowDown')
  await expect(currency).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('listbox')).toHaveCount(0)

  // The fence: a dropdown with no reason opens from the same presses
  const category = dialog.locator('#txn-category')
  await category.click()
  await expect(category).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('listbox')).toHaveCount(1)
})

test('shows the reason on keyboard focus and puts it away on Escape without closing the window', async ({ page, request }) => {
  const dialog = await openRefusedBulkEdit(page, request)
  const apply = dialog.getByRole('button', { name: 'Apply', exact: true })
  const tooltip = page.getByTestId(TOOLTIP).filter({ hasText: NOTHING_CHOSEN })

  // The press that refused the form left the pointer over Apply, so a keyboard user's turn starts with it away
  await page.mouse.move(0, 0)
  await expectFadedOut(tooltip)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(apply).toBeFocused()
  await expect(tooltip).toHaveCSS('opacity', '1')

  await page.keyboard.press('Escape')
  await expectFadedOut(tooltip)
  await expect(dialog).toBeVisible()
  await expect(apply).toBeFocused()

  // With the reason gone, a second Escape is the window's own and closes it
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('puts away a reason shown under the pointer on Escape without closing the window', async ({ page, request }) => {
  const dialog = await openRefusedBulkEdit(page, request)
  const apply = dialog.getByRole('button', { name: 'Apply', exact: true })
  const tooltip = page.getByTestId(TOOLTIP).filter({ hasText: NOTHING_CHOSEN })

  await apply.hover()
  await expect(tooltip).toHaveCSS('opacity', '1')
  await expect(apply).not.toBeFocused()

  await page.keyboard.press('Escape')
  await expectFadedOut(tooltip)
  await expect(dialog).toBeVisible()
})

// With reduced motion the reason is placed once, where the pointer enters. It used to be measured before
// its words were in, a few pixels high, and so was placed too low, back under the pointer
test('places a reason above the pointer under reduced motion', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const dialog = await openRefusedBulkEdit(page, request)
  const apply = dialog.getByRole('button', { name: 'Apply', exact: true })

  const box = (await apply.boundingBox())!
  const pointer = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(2, 2)
  await page.mouse.move(pointer.x, pointer.y)
  const reason = page.getByTestId(TOOLTIP).getByText(NOTHING_CHOSEN, { exact: true })
  await expect(reason).toBeVisible()
  await expect.poll(async () => {
    const shown = await reason.boundingBox()
    return shown!.y + shown!.height <= pointer.y
  }).toBe(true)
})

test('swaps a reason shown under the pointer for the next one when the form moves on', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings')
  const pane = page.locator('#security')
  const save = pane.getByRole('button', { name: 'Save', exact: true })
  const tooltip = page.getByTestId(TOOLTIP)

  await pane.getByLabel('New password', { exact: true }).fill('abc')
  await save.hover()
  await expect(tooltip.getByText('Enter your current password to save', { exact: true })).toBeVisible()

  // The pointer stays on Save while the field is filled, and the unmet rule has moved on to the next one
  await pane.getByLabel('Current password', { exact: true }).fill(user.password)
  await expect(tooltip.getByText('Choose a new password that meets the requirements', { exact: true })).toBeVisible()
  await expect(tooltip.getByText('Enter your current password to save', { exact: true })).toHaveCount(0)
})

test.describe('on a touch screen', () => {
  test.use({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } })

  test('shows the reason on a tap and keeps it until the next tap elsewhere', async ({ page }) => {
    await page.goto('/signup')
    await page.getByLabel('First name').fill('Test')
    await page.getByLabel('Email').fill('not-an-email')
    await page.getByLabel('Last name').fill('User')
    const submit = page.getByRole('button', { name: 'Sign up', exact: true })
    await expect(submit).toHaveAttribute('aria-disabled', 'true')
    const tooltip = page.getByTestId(TOOLTIP).filter({ hasText: FIX_FIELDS })
    await expectFadedOut(tooltip)

    await submit.tap({ force: true })
    await expect(tooltip).toHaveCSS('opacity', '1')

    await page.touchscreen.tap(8, 8)
    await expectFadedOut(tooltip)
  })
})

test('explains the tags dropdown while no account is chosen', async ({ page, request }) => {
  const user = await signUpUser(request)
  await createAccount(request, user, { name: 'Everyday' })
  await createAccount(request, user, { name: 'Savings' })
  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  const dialog = await openModal(page, ['Add transaction'], 'Add transaction')
  const tags = dialog.locator('#txn-tags')

  await expect(tags).toHaveAttribute('aria-disabled', 'true')
  await expect(tags).toHaveAccessibleDescription('Select an account first')

  // Over the field, the reason shows in front of the window and moves with the pointer
  const field = (await tags.boundingBox())!
  const midY = field.y + field.height / 2
  await page.mouse.move(2, 2)
  await page.mouse.move(field.x + 40, midY)
  const tooltip = page.getByTestId(TOOLTIP).filter({ hasText: 'Select an account first' })
  await expect(tooltip).toHaveCSS('opacity', '1')
  // The card inside the tooltip carries the flip, so its box is the one on screen, read once it has settled
  const card = tooltip.locator('.app-cursor-tooltip-flip')
  await expect.poll(async () => (await card.boundingBox())?.height ?? 0).toBeGreaterThan(0)
  const before = (await card.boundingBox())!

  // Across the field the reason keeps its distance from the pointer, so its position moves by what the pointer moved
  await page.mouse.move(field.x + field.width - 40, midY, { steps: 5 })
  await expect.poll(async () => (await card.boundingBox())!.x - before.x).toBeGreaterThan(field.width - 80 - 2)
  const across = (await card.boundingBox())!
  expect(across.x - before.x).toBeLessThanOrEqual(field.width - 80 + 2)
  await page.mouse.move(field.x + field.width - 40, midY - 8, { steps: 3 })
  await expect.poll(async () => across.y - (await card.boundingBox())!.y).toBeGreaterThan(6)
  // The tooltip passes pointer events through, so its stacking is read from the layers: above the window's backdrop
  const layers = await page.evaluate(() => {
    const level = (selector: string) => Number(getComputedStyle(document.querySelector(selector)!).zIndex)
    return { tooltip: level('[data-testid="disabled-reason-tooltip"]'), backdrop: level('.app-modal-backdrop') }
  })
  expect(layers.tooltip).toBeGreaterThan(layers.backdrop)

  // On keyboard focus there is no pointer, so the reason sits beside the field and over no other field
  await page.mouse.move(2, 2)
  await expectFadedOut(tooltip)
  await page.keyboard.press('Shift')
  await tags.focus()
  await expect(tooltip).toHaveCSS('opacity', '1')
  await expect.poll(async () => {
    const shown = await card.boundingBox()
    const field = await tags.boundingBox()
    return shown && field ? shown.y >= field.y + field.height || shown.y + shown.height <= field.y : false
  }).toBe(true)
  const others = await dialog.locator('input, textarea, button[id^="txn-"]').evaluateAll((nodes) => (
    nodes.filter((node) => node.id !== 'txn-tags').map((node) => node.getBoundingClientRect().toJSON() as DOMRect)
  ))
  const shown = (await card.boundingBox())!
  const overlaps = others.filter((other) => (
    other.width > 0 && other.height > 0
    && shown.x < other.right && shown.x + shown.width > other.left
    && shown.y < other.bottom && shown.y + shown.height > other.top
  ))
  expect(overlaps).toEqual([])

  // The fence: choosing an account frees the field and the reason goes with it
  await dialog.locator('#txn-account').click()
  await page.getByRole('option', { name: /^Savings\b/ }).click()
  await expect(tags).not.toHaveAttribute('aria-disabled', 'true')
  await expect(tags).not.toHaveAccessibleDescription('Select an account first')
})
