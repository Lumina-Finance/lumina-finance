import { expect, test, type Locator, type Page } from '@playwright/test'

import { createAccount, createTransaction, signUpUser } from '../support/api'
import { openPage, chooseFromDropdown, logInViaApi, openModal, waitForRequestsSoFar } from '../support/app'
import {
  expectPendingAction,
  expectStretchedFocusRing,
  getAccountRow,
  getTransactionRowButton,
  MINUS,
  whileApiRequestHeld,
} from '../support/selectors'
import { AT_EVERY_SIZE } from '../support/sizes'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only. The lost save and account row focus tests run at every size:
// the starting balance prompt's message and the account row's text sit differently at each width.
// Creating, recording and editing accounts give the same result at every size

const ACCOUNT_NAME = 'Everyday Chequing'

/**
 * Create an account through the modal on the accounts page.
 *
 * @param page - Page already showing the accounts page
 * @param accountType - Label of the type to choose, a chequing account unless given
 * @param name - Name to give the account
 * @returns The prompt that saving the account opens, with the account kept manual so its starting
 * balance shows
 */
async function createAccountThroughModal(page: Page, accountType = 'Checking', name = ACCOUNT_NAME): Promise<Locator> {
  const dialog = await openModal(page, ['Add account'], 'Add account')
  await chooseFromDropdown(dialog, 'Account type', accountType)
  await dialog.getByLabel('Account name').fill(name)

  // Currency is left alone: it already holds the base currency chosen at signup
  await dialog.getByRole('button', { name: 'Create account' }).click()

  await expect(dialog).toBeHidden()
  const prompt = page.getByRole('dialog', { name: 'Keep it up to date' })
  await expect(prompt).toBeVisible()
  await prompt.getByRole('radio', { name: /^Keep it manual/ }).click()
  return prompt
}

/**
 * Skip the starting balance prompt that saving a new account opens, for a test about something else.
 *
 * @param page - Page whose prompt has just opened
 */
async function skipStartingBalancePrompt(page: Page): Promise<void> {
  // With a bank provider on offer the prompt asks how the account stays up to date first, and it
  // holds the starting balance once the account is kept manual
  const prompt = page.getByRole('dialog', { name: /^(Keep it up to date|Add a starting balance)$/ })
  await expect(prompt).toBeVisible()
  const manual = prompt.getByRole('radio', { name: /^Keep it manual/ })
  if (await manual.count()) await manual.click()
  await prompt.getByRole('button', { name: /^(Skip|Decide later)$/ }).click()
  await expect(prompt).toBeHidden()
}

/**
 * Collect every starting balance request the page sends from now on, so a prompt that closes
 * without recording can be shown to have sent none, not even one answered after it closed.
 *
 * @param page - Page to watch
 * @returns The URLs sent so far, kept current as the page sends more
 */
function watchStartingBalanceRequests(page: Page): string[] {
  const urls: string[] = []
  page.on('request', (sent) => {
    if (sent.url().endsWith('/starting-balance')) urls.push(sent.url())
  })
  return urls
}

test('starts a new user with no accounts and creates one with its starting balance', async ({ page, request }) => {
  const user = await signUpUser(request)

  await logInViaApi(page, user)
  await openPage(page, '/accounts')

  // Both halves are needed before the empty state means anything. The list is given no error to
  // show, so a failed accounts request renders the same empty label a new user sees. Waiting for
  // the summary's placeholder to go says the request settled, and the summary label is there
  // only when it settled without an error, since a failure replaces the whole summary
  await expect(page.getByRole('status', { name: 'Loading net worth value' })).toBeHidden()
  await expect(page.getByText('Net worth')).toBeVisible()

  // A fresh user sees this even against a database holding other people's records, so the
  // assertion also fails if row-level security ever stops separating one user from another
  await expect(page.getByText('No accounts yet')).toBeVisible()

  const prompt = await createAccountThroughModal(page)
  await prompt.getByLabel('Starting balance', { exact: true }).fill('1250.00')
  await prompt.getByRole('button', { name: 'Continue' }).click()

  await expect(prompt).toBeHidden()
  const row = getAccountRow(page, ACCOUNT_NAME)
  await expect(row).toContainText('$1,250.00')

  // Tabbing to the account hears what the row shows beside its name, the balance included. In a group
  // by type the row's line names the bank, and an account with none says so
  await expect(row.getByRole('link', { name: ACCOUNT_NAME, exact: true })).toHaveAccessibleDescription('No institution $1,250.00')
})

test('records a new credit card\'s amount owed as a balance below zero', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/accounts')

  const prompt = await createAccountThroughModal(page, 'Credit card', 'Rewards Card')
  await prompt.getByLabel('Starting amount owed', { exact: true }).fill('400.00')
  await prompt.getByRole('button', { name: 'Continue' }).click()

  await expect(prompt).toBeHidden()
  // The list writes a balance below zero in parentheses
  await expect(getAccountRow(page, 'Rewards Card')).toContainText('($400.00)')
})

test('shows a server without bank sync no bank choice, link section or blank institution line', async ({ page, request }) => {
  const user = await signUpUser(request)
  await page.route(`${API_BASE_URL}/bank-sync/providers`, (route) => route.fulfill({ json: { may_link: false, providers: [] } }))
  await logInViaApi(page, user)
  await openPage(page, '/accounts')

  const createDialog = await openModal(page, ['Add account'], 'Add account')
  await chooseFromDropdown(createDialog, 'Account type', 'Checking')
  await createDialog.getByLabel('Account name').fill(ACCOUNT_NAME)
  await createDialog.getByRole('button', { name: 'Create account' }).click()
  await expect(createDialog).toBeHidden()

  // The prompt opens on the starting balance, with no choice of how the account stays up to date
  const prompt = page.getByRole('dialog', { name: 'Add a starting balance' })
  await expect(prompt).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Keep it up to date' })).toHaveCount(0)
  await expect(prompt.getByRole('radio')).toHaveCount(0)
  await prompt.getByRole('button', { name: /^(Skip|Decide later)$/ }).click()
  await expect(prompt).toBeHidden()

  await page.getByRole('link', { name: new RegExp(ACCOUNT_NAME) }).click()
  await expect(page.getByRole('heading', { name: ACCOUNT_NAME, level: 1 })).toBeVisible()

  // The identity card reads as it always has, with its institution line filled at once and no way into bank sync
  await expect(page.getByText('No institution', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Bank sync:/ })).toHaveCount(0)

  await page.getByRole('button', { name: 'Edit account', exact: true }).click()
  const editDialog = page.getByRole('dialog', { name: 'Edit account', exact: true })
  await expect(editDialog.getByLabel('Account name', { exact: true })).toBeVisible()
  await expect(editDialog.getByText('Bank link', { exact: true })).toHaveCount(0)
})

test('names no institution as the account page first shows on a server without bank sync, though the providers answer last', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: ACCOUNT_NAME })

  // Records the institution line as the account's name first appears, before any later read can fill it
  await page.addInitScript((name) => {
    new MutationObserver((_, observer) => {
      const heading = [...document.querySelectorAll('h1')].find((element) => element.textContent === name)
      if (!heading) return
      ;(window as Window & { firstInstitutionLine?: string }).firstInstitutionLine =
        heading.nextElementSibling?.textContent ?? ''
      observer.disconnect()
    }).observe(document, { childList: true, subtree: true, characterData: true })
  }, ACCOUNT_NAME)

  // The providers answer only once the account's own read has reached the page and had a frame to draw
  let releaseProviders!: () => void
  const providersHeld = new Promise<void>((resolve) => { releaseProviders = resolve })
  await page.route(`${API_BASE_URL}/bank-sync/providers`, async (route) => {
    await providersHeld
    await route.fulfill({ json: { may_link: false, providers: [] } })
  })
  await logInViaApi(page, user)
  const accountRead = page.waitForResponse((response) =>
    response.request().method() === 'GET' && new URL(response.url()).pathname.endsWith(`/accounts/${account.id}`))
  await page.goto(`/accounts/${account.id}`)
  await accountRead
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  releaseProviders()

  await expect(page.getByRole('heading', { name: ACCOUNT_NAME, level: 1 })).toBeVisible()
  expect(await page.evaluate(() => (window as Window & { firstInstitutionLine?: string }).firstInstitutionLine))
    .toBe('No institution')
})

test('reads the bank providers while Add account is open, so the prompt after the save need not wait for them', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/accounts')

  // Watched from here, so a read the accounts page made while loading cannot stand in for the dialogue's
  const providersRead = page.waitForRequest(`${API_BASE_URL}/bank-sync/providers`, { timeout: 5_000 })
  const dialog = await openModal(page, ['Add account'], 'Add account')
  await providersRead
  await expect(dialog).toBeVisible()
})

test('leaves a new account at zero when its starting balance is left blank', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/accounts')
  const startingBalanceRequests = watchStartingBalanceRequests(page)

  const prompt = await createAccountThroughModal(page)
  await prompt.getByRole('button', { name: 'Continue' }).click()

  await expect(prompt).toBeHidden()
  await expect(getAccountRow(page, ACCOUNT_NAME)).toContainText('$0.00')
  await waitForRequestsSoFar(page)
  expect(startingBalanceRequests).toEqual([])
})

test('leaves a new account at zero when its starting balance is left for later', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/accounts')
  const startingBalanceRequests = watchStartingBalanceRequests(page)

  const prompt = await createAccountThroughModal(page)
  await prompt.getByLabel('Starting balance', { exact: true }).fill('300.00')
  await prompt.getByRole('button', { name: 'Decide later' }).click()

  await expect(prompt).toBeHidden()
  await expect(getAccountRow(page, ACCOUNT_NAME)).toContainText('$0.00')
  await waitForRequestsSoFar(page)
  expect(startingBalanceRequests).toEqual([])
})

test('answers a minus typed into the starting balance rather than dropping it', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/accounts')

  const prompt = await createAccountThroughModal(page)
  const balance = prompt.getByLabel('Starting balance', { exact: true })
  const error = prompt.getByRole('alert').filter({ hasText: 'Must be zero or higher' })
  await balance.pressSequentially('-')

  await expect(balance).toHaveValue('')
  await expect(balance).toHaveAttribute('aria-invalid', 'true')
  await expect(error).toBeVisible()

  await balance.pressSequentially('5')
  await expect(balance).toHaveValue('5')
  await expect(balance).not.toHaveAttribute('aria-invalid', 'true')
  await expect(error).toBeHidden()
})

test('refuses over-long notes in Add account and scrolls long notes by keyboard', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/accounts')

  const createDialog = await openModal(page, ['Add account'], 'Add account')
  await chooseFromDropdown(createDialog, 'Account type', 'Checking')
  await createDialog.getByLabel('Account name').fill(ACCOUNT_NAME)
  await createDialog.getByLabel('Notes').fill('x'.repeat(2001))
  await createDialog.getByLabel('Account name').focus()
  await expect(createDialog.getByRole('alert')).toHaveText('Notes must be 2000 characters or less.')
  await createDialog.getByLabel('Notes').fill(Array.from({ length: 40 }, (_, line) => `Line ${line + 1}`).join('\n'))
  await createDialog.getByRole('button', { name: 'Create account' }).click()
  await expect(createDialog).toBeHidden()
  await skipStartingBalancePrompt(page)

  await page.getByRole('link', { name: new RegExp(ACCOUNT_NAME) }).click()
  const notes = page.getByRole('region', { name: 'Notes' })
  await expect(notes).toContainText('Line 40')
  await notes.focus()
  await expect(notes).toBeFocused()
  await page.keyboard.press('End')
  await expect.poll(() => notes.evaluate((node) => node.scrollTop)).toBeGreaterThan(0)
})

test('keeps the notes written for an account, shows them on its page and clears them', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/accounts')

  const createDialog = await openModal(page, ['Add account'], 'Add account')
  await chooseFromDropdown(createDialog, 'Account type', 'Checking')
  await createDialog.getByLabel('Account name').fill(ACCOUNT_NAME)
  await createDialog.getByLabel('Notes').fill('Account 123-456\nCustomer 42')
  await createDialog.getByRole('button', { name: 'Create account' }).click()
  await expect(createDialog).toBeHidden()
  await skipStartingBalancePrompt(page)

  await page.getByRole('link', { name: new RegExp(ACCOUNT_NAME) }).click()
  const notes = page.getByText('Customer 42')
  await expect(notes).toHaveText('Account 123-456\nCustomer 42')

  await page.getByRole('button', { name: 'Edit account', exact: true }).click()
  const editDialog = page.getByRole('dialog', { name: 'Edit account', exact: true })
  const field = editDialog.getByLabel('Notes')
  await expect(field).toHaveValue('Account 123-456\nCustomer 42')
  await field.fill('x'.repeat(2001))
  await editDialog.getByTestId('account-submit').click()
  await expect(editDialog.getByRole('alert')).toHaveText('Notes must be 2000 characters or less.')
  await expect(field).toHaveAttribute('aria-invalid', 'true')

  await field.fill('')
  await editDialog.getByTestId('account-submit').click()
  await expect(editDialog).toBeHidden()
  await expect(notes).toHaveCount(0)
  await expect(page.getByText('Notes', { exact: true })).toHaveCount(0)
})

test('lets a refused minus in an empty field be cleared, and refuses Continue while it shows', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/accounts')
  const startingBalanceRequests = watchStartingBalanceRequests(page)

  const prompt = await createAccountThroughModal(page)
  const balance = prompt.getByLabel('Starting balance', { exact: true })
  const error = prompt.getByRole('alert').filter({ hasText: 'Must be zero or higher' })

  // Text holding a minus is refused whole, so the field stays empty while it says why
  await balance.fill('-5')
  await expect(balance).toHaveValue('')
  await expect(error).toBeVisible()

  // Deleting in the field it left empty changes no text, and is still the answer to the message
  await balance.press('Backspace')
  await expect(error).toBeHidden()

  // Continue refuses while the message shows: it fades with the reason, stays focusable, takes the
  // press for nothing and moves focus to the field
  await balance.fill('-5')
  await expect(error).toBeVisible()
  const continueButton = prompt.getByRole('button', { name: 'Continue' })
  await expect(continueButton).not.toHaveAttribute('aria-disabled', 'true')
  await continueButton.click()
  await expect(continueButton).toHaveAttribute('aria-disabled', 'true')
  await expect(continueButton).toHaveAccessibleDescription('Must be zero or higher')
  await expect(balance).toBeFocused()
  await continueButton.press('Enter')
  await expect(prompt).toBeVisible()

  // Taking the minus back makes Continue whole again, and a blank field then closes as blank
  await balance.press('Backspace')
  await expect(error).toBeHidden()
  await expect(continueButton).not.toHaveAttribute('aria-disabled', 'true')
  await continueButton.click()

  await expect(prompt).toBeHidden()
  await expect(getAccountRow(page, ACCOUNT_NAME)).toContainText('$0.00')
  await waitForRequestsSoFar(page)
  expect(startingBalanceRequests).toEqual([])
})

test('closes the prompt as saved when the save lands but its answer is lost', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/accounts')

  const prompt = await createAccountThroughModal(page)

  // The balance reaches the server and is saved, then the browser is told the connection failed
  await page.route(`${API_BASE_URL}/accounts/*/starting-balance`, async (route) => {
    await route.fetch()
    await route.abort('failed')
  })
  await prompt.getByLabel('Starting balance', { exact: true }).fill('1250.00')
  await prompt.getByRole('button', { name: 'Continue' }).click()

  // The account is read after the lost answer, and holding the balance means the save landed
  await expect(prompt).toBeHidden()
  await expect(getAccountRow(page, ACCOUNT_NAME)).toContainText('$1,250.00')
})

test('keeps the prompt and the typed balance when a save is lost before it lands', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/accounts')

  const prompt = await createAccountThroughModal(page)
  const balance = prompt.getByLabel('Starting balance', { exact: true })
  const buttons = [prompt.getByRole('button', { name: 'Decide later' }), prompt.getByRole('button', { name: 'Continue' })]
  const buttonWidths = () => Promise.all(buttons.map(async (button) => (await button.boundingBox())?.width))
  const widthsBeforeMessage = await buttonWidths()

  // The save never reaches the server, so the account read after it is still at zero
  const saveUrl = `${API_BASE_URL}/accounts/*/starting-balance`
  await page.route(saveUrl, (route) => route.abort('failed'))
  await balance.fill('1250.00')
  await prompt.getByRole('button', { name: 'Continue' }).click()

  await expect(prompt.getByRole('alert')).toHaveText('Oops, your starting balance wasn\'t saved. Please press Continue to try again.')
  await expect(balance).toHaveValue('1250.00')

  // The message wraps beside the buttons rather than taking width from them. Continue grows back
  // from its saving state, so its width is read once that has settled
  await expect.poll(buttonWidths).toEqual(widthsBeforeMessage)

  await page.unroute(saveUrl)
  await prompt.getByRole('button', { name: 'Continue' }).click()

  await expect(prompt).toBeHidden()
  await expect(getAccountRow(page, ACCOUNT_NAME)).toContainText('$1,250.00')
})

test('records an expense through the modal and shows it as money out', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: ACCOUNT_NAME })

  await logInViaApi(page, user)
  await openPage(page, '/transactions')

  const dialog = await openModal(page, ['Add transaction'], 'Add transaction')
  const accountControl = dialog.getByTestId('transaction-account')
  await expect(accountControl).toHaveRole('combobox')
  await expect(accountControl).toHaveAccessibleName('Account')
  await accountControl.click()
  await dialog.getByRole('option', { name: new RegExp(account.name) }).click()
  await chooseFromDropdown(dialog, 'Merchant', 'Unknown')
  await chooseFromDropdown(dialog, 'Category', 'Groceries')
  await dialog.getByLabel('Amount').fill('42.50')
  const submit = dialog.getByTestId('transaction-submit')
  await expect(submit).toHaveRole('button')
  await expect(submit).toHaveAccessibleName('Add transaction')
  await whileApiRequestHeld(page, 'POST', '/transactions',
    () => submit.click(), () => expectPendingAction(submit, 'Add transaction'),
    { account_id: account.id })

  await expect(dialog).toBeHidden()

  const row = page.getByTestId(/^transaction-row-/)
  await expect(row).toHaveCount(1)
  await expect(getTransactionRowButton(row)).toHaveAccessibleName('Unknown')
  await expect(row.getByTestId('transaction-amount').filter({ visible: true })).toHaveText(`${MINUS}$42.50`)
  // A screen reader hears the signed amount with the row, as main checked through the row's name
  await expect(getTransactionRowButton(row)).toHaveAccessibleDescription(new RegExp(`${MINUS}\\$42\\.50`))
})

test('rings an account row in the focus colour under keyboard focus', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  await createAccount(request, user, { name: ACCOUNT_NAME })
  await logInViaApi(page, user)
  await openPage(page, '/accounts')

  // The row is the rounded box the hover tint fills
  const row = getAccountRow(page, ACCOUNT_NAME)
  await expectStretchedFocusRing(row.getByRole('link', { name: ACCOUNT_NAME, exact: true }), row)
})

test('keeps the account save action named while an edit is pending', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Account before edit' })
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  await page.getByRole('button', { name: 'Edit account', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit account', exact: true })
  await dialog.getByLabel('Account name').fill('Account after edit')
  const submit = dialog.getByTestId('account-submit')
  await expect(submit).toHaveRole('button')
  await expect(submit).toHaveAccessibleName('Save changes')
  await whileApiRequestHeld(page, 'PATCH', `/accounts/${account.id}`,
    () => submit.click(), () => expectPendingAction(submit, 'Save changes'))
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Account after edit', exact: true })).toBeVisible()
})

// A deleted account's page stays on screen while it animates out, and nothing on it may ask the server
// about the account again, which answers every such request with not found
test('asks nothing more about an account once it is deleted from its page', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: ACCOUNT_NAME })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -500 })

  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  await page.getByRole('button', { name: 'Edit account', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit account', exact: true })
  await dialog.getByRole('button', { name: 'Delete account', exact: true }).click()
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click()
  const confirmation = dialog.getByLabel(`Type "${ACCOUNT_NAME}" to delete.`, { exact: true })
  await confirmation.fill(ACCOUNT_NAME)

  const isAboutAccount = (url: string) => url.includes(account.id)
  let deleted = false
  const askedAfterDelete: string[] = []
  page.on('response', (response) => {
    if (response.request().method() === 'DELETE' && isAboutAccount(response.url()) && response.ok()) deleted = true
  })
  page.on('request', (sent) => {
    if (deleted && isAboutAccount(sent.url())) askedAfterDelete.push(`${sent.method()} ${sent.url()}`)
  })
  await confirmation.press('Enter')

  await expect(page).toHaveURL(/\/accounts$/)
  await expect(page.getByRole('heading', { name: 'My accounts', exact: true })).toBeVisible()
  // The account's page fades out over the list, and a request it sent late in that fade would still count
  await expect(page.getByRole('heading', { name: ACCOUNT_NAME, exact: true })).toHaveCount(0)
  expect(deleted).toBe(true)
  expect(askedAfterDelete).toEqual([])
})
