import { expect, test, type APIRequestContext, type Locator, type Page, type Request } from '@playwright/test'

import { createAccount, createTransaction, daysFromTodayInTestTimezone, signUpUser, TEST_PASSWORD } from '../support/api'
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
  const signupRequests = recordRequests(page, 'POST', /\/auth\/signup$/)
  const email = `e2e-${crypto.randomUUID()}@example.com`
  await page.goto('/signup')
  await page.getByLabel('First name').fill('Test')
  await page.getByLabel('Email').fill('not-an-email')
  await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD)
  await page.getByLabel('Confirm password').fill(TEST_PASSWORD)
  const submit = page.getByRole('button', { name: 'Sign up', exact: true })
  // Leaving the email for the next field checks it, finds it wrong and holds the button off
  await expect(page.getByText('Enter a valid email address', { exact: true })).toBeVisible()
  await expect(submit).toHaveAttribute('aria-disabled', 'true')
  await expect(submit).toHaveAccessibleDescription(FIX_FIELDS)

  await submit.click({ force: true })
  await page.getByLabel('Confirm password').press('Enter')
  await submit.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/signup$/)

  // The fence: with the email put right the same button signs up, and that one request is all that was sent
  await page.getByLabel('Email').fill(email)
  await expect(submit).not.toHaveAttribute('aria-disabled', 'true')
  const signedUp = page.waitForResponse((response) => response.request().method() === 'POST' && /\/auth\/signup$/.test(new URL(response.url()).pathname))
  await submit.click()
  expect((await signedUp).status()).toBe(201)
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
  const dialog = await openBulkEdit(page, request)
  const apply = dialog.getByRole('button', { name: 'Apply', exact: true })
  const tooltip = page.getByTestId(TOOLTIP).filter({ hasText: NOTHING_CHOSEN })

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
  const dialog = await openBulkEdit(page, request)
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
// its words were in, a few pixels high, and so was placed back over the button it explains
test('places a reason clear above its button under reduced motion', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const dialog = await openBulkEdit(page, request)
  const apply = dialog.getByRole('button', { name: 'Apply', exact: true })

  await apply.hover()
  const reason = page.getByTestId(TOOLTIP).getByText(NOTHING_CHOSEN, { exact: true })
  await expect(reason).toBeVisible()
  await expect.poll(async () => {
    const [shown, button] = [await reason.boundingBox(), await apply.boundingBox()]
    return shown!.y + shown!.height <= button!.y
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
    await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD)
    await page.getByLabel('Confirm password').fill(TEST_PASSWORD)
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
