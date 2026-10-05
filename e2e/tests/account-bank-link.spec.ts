import { expect, test, type Locator, type Page } from '@playwright/test'

import { createAccount, signUpUser, TEST_TIMEZONE, todayInTestTimezone, type TestUser } from '../support/api'
import { chooseFromDropdown, logInViaApi, openModal, openPage } from '../support/app'
import {
  addBridgeBankAccount,
  addBridgeBankLogin,
  claimSetupToken,
  createEmptyBridgeScenario,
  createSampleBridgeScenario,
  linkBankAccount,
  type SeededConnection,
} from '../support/bankSync'
import { API_BASE_URL } from '../support/target'

// An account links to a bank account from its own page, through the Bank link section of its edit
// modal, which the identity card's Bank sync fact opens, and straight after it is created. Connections
// are claimed from the fake SimpleFIN Bridge the instance syncs with, and links are made and ended on
// the server. Only whether the deployment's worker is running is answered here instead
const SAMPLE_BANK = 'Harbour Bank'
const SAMPLE_CHEQUING = 'Everyday Chequing'
const SAMPLE_VISA = 'Rewards Visa'
const LINKING_PAUSED = "Bank sync isn't running right now. You can link accounts once it's back."

/**
 * Today as the app writes a day, in the zone the user signed up with
 */
function formatToday(): string {
  return new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', year: 'numeric', timeZone: TEST_TIMEZONE }).format(new Date())
}

/**
 * The first day of the month a number of months before this one, as YYYY-MM-DD
 */
function firstOfMonthsAgo(months: number): string {
  const [year, month] = todayInTestTimezone().split('-').map(Number)
  return new Date(Date.UTC(year, month - 1 - months, 1)).toISOString().slice(0, 10)
}

function externalIdOf(connection: SeededConnection, name: string): string {
  return connection.accounts.find((bankAccount) => bankAccount.name === name)!.external_id
}

function toast(page: Page, text: string): Locator {
  return page.getByRole('status').filter({ hasText: text })
}

/**
 * One of the facts in the Bank link section, by its label
 */
function fact(dialog: Locator, label: string): Locator {
  return dialog.locator('dl > div').filter({ has: dialog.page().locator('dt', { hasText: label }) }).locator('dd')
}

/**
 * The tooltip carrying a disabled control's reason, which sits on the page rather than beside the
 * control and fades rather than leaving
 */
function shownReason(page: Page, reason: string): Locator {
  return page.locator('body > div[aria-hidden="true"]').filter({ hasText: reason })
}

/**
 * Opens the account's page and, through the identity card's Bank sync fact, its edit modal at the
 * Bank link section
 *
 * @param status - The status label the fact should show first
 */
async function openBankLink(page: Page, user: TestUser, accountId: string, status: string): Promise<Locator> {
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${accountId}`)
  await page.getByRole('button', { name: `Bank sync: ${status}. Open bank link` }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit Account', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

/**
 * Chooses the first start on offer, whichever the account's ledger leaves
 */
async function chooseFirstStart(flow: Locator): Promise<void> {
  await flow.getByRole('radiogroup', { name: 'Start' }).getByRole('radio').first().click()
}

async function changeProviders(page: Page, change: (body: { sync_running: boolean }) => void): Promise<void> {
  await page.route(`${API_BASE_URL}/bank-sync/providers`, async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    change(body)
    await route.fulfill({ response, json: body })
  })
}

// A read the page sends as a test ends can still be on its way through a changed answer when the page
// closes, which would fail a test whose checks all passed
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

test('links an account from its page, from choosing the bank account to its import', async ({ page, request }) => {
  const user = await signUpUser(request)
  const [everyday, scenario] = await Promise.all([
    createAccount(request, user, { name: 'Everyday' }),
    createSampleBridgeScenario(request),
  ])
  const connection = await claimSetupToken(request, user, scenario.setupToken)
  const dialog = await openBankLink(page, user, everyday.id, 'Not linked')

  const linkButton = dialog.getByRole('button', { name: 'Link bank account' })
  await expect(linkButton).toBeInViewport()
  await expect(dialog.getByText('Link this account to one of the bank accounts on your connections to bring in its transactions automatically.')).toBeVisible()
  await linkButton.click()

  const flow = page.getByRole('dialog', { name: 'Link bank account' })
  await expect(flow.getByText('Choose the bank account')).toBeVisible()
  await expect(flow.getByRole('radio', { name: new RegExp(`^${SAMPLE_VISA}`) })).toContainText(SAMPLE_BANK)
  const continueButton = flow.getByRole('button', { name: 'Continue' })
  await expect(continueButton).toBeDisabled()
  await flow.getByRole('radio', { name: new RegExp(`^${SAMPLE_CHEQUING}`) }).click()
  await continueButton.click()

  await expect(flow.getByText('Choose where history starts')).toBeVisible()
  await expect(flow.getByText(`${SAMPLE_CHEQUING} brings in transactions from the start you choose through today.`)).toBeVisible()
  await expect(flow.getByRole('radio', { checked: true })).toHaveCount(0)
  const submit = flow.getByRole('button', { name: 'Link and import' })
  await expect(submit).toBeDisabled()

  // Back keeps the bank account chosen
  await flow.getByRole('button', { name: 'Back' }).click()
  await expect(flow.getByRole('radio', { name: new RegExp(`^${SAMPLE_CHEQUING}`) })).toBeChecked()
  await continueButton.click()

  await flow.getByRole('radio', { name: /^3 months/ }).click()
  const linked = page.waitForRequest((sent) => sent.url() === `${API_BASE_URL}/accounts/${everyday.id}/bank-link` && sent.method() === 'POST')
  await submit.click()

  expect((await linked).postDataJSON()).toEqual({
    connection_id: connection.id,
    external_account_id: externalIdOf(connection, SAMPLE_CHEQUING),
    start_date: firstOfMonthsAgo(3),
  })
  await expect(toast(page, 'Linked. Importing history now.')).toBeVisible()
  await expect(flow).toBeHidden()
  await expect(fact(dialog, 'Bank account')).toHaveText(SAMPLE_CHEQUING)
  await expect(fact(dialog, 'Institution')).toHaveText(SAMPLE_BANK)
  await expect(fact(dialog, 'Through')).toHaveText('SimpleFIN')
  await expect(fact(dialog, 'Status')).not.toHaveText('Not linked')
  await expect(dialog.getByRole('button', { name: 'Unlink' })).toBeVisible()
})

test("lists the bank accounts that can't be linked with the reason for each", async ({ page, request }) => {
  const user = await signUpUser(request)
  const [everyday, household, scenario] = await Promise.all([
    createAccount(request, user, { name: 'Everyday' }),
    createAccount(request, user, { name: 'Household' }),
    createEmptyBridgeScenario(request),
  ])
  const login = await addBridgeBankLogin(request, scenario.id, SAMPLE_BANK)
  await addBridgeBankAccount(request, scenario.id, { connId: login, name: SAMPLE_CHEQUING, currency: 'CAD' })
  await addBridgeBankAccount(request, scenario.id, { connId: login, name: 'US Dollar Savings', currency: 'USD' })
  await addBridgeBankAccount(request, scenario.id, { connId: login, name: 'Flight Miles', currency: 'https://www.simplefin.org/currencies/miles' })
  const connection = await claimSetupToken(request, user, scenario.setupToken)
  await linkBankAccount(request, user, {
    accountId: household.id,
    connectionId: connection.id,
    externalAccountId: externalIdOf(connection, SAMPLE_CHEQUING),
    startDate: todayInTestTimezone(),
  })
  const dialog = await openBankLink(page, user, everyday.id, 'Not linked')
  await dialog.getByRole('button', { name: 'Link bank account' }).click()
  const flow = page.getByRole('dialog', { name: 'Link bank account' })

  const reasons = [
    [SAMPLE_CHEQUING, 'Already linked to Household'],
    ['US Dollar Savings', 'In USD, but Everyday is in CAD'],
    ['Flight Miles', "Uses a currency of its own, which Lumina Finance can't track"],
  ]
  for (const [name, reason] of reasons) {
    const card = flow.getByRole('radio', { name: new RegExp(`^${name}`) })
    await expect(card).toBeDisabled()
    await expect(card).toContainText(reason)
  }
  await expect(flow.getByRole('button', { name: 'Continue' })).toBeDisabled()
})

test('sends an account with no connection to settings first', async ({ page, request }) => {
  const user = await signUpUser(request)
  const everyday = await createAccount(request, user, { name: 'Everyday' })
  const dialog = await openBankLink(page, user, everyday.id, 'Not linked')
  await dialog.getByRole('button', { name: 'Link bank account' }).click()
  const flow = page.getByRole('dialog', { name: 'Link bank account' })

  await expect(flow.getByText('Connect a provider first')).toBeVisible()
  await expect(flow.getByText('Add a bank connection in Settings first.')).toBeVisible()
  await flow.getByRole('button', { name: 'Open settings' }).click()

  await expect(page).toHaveURL(/\/settings#bank-connections$/)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('keeps the start within the range and never chooses Custom date on its own', async ({ page, request }) => {
  const user = await signUpUser(request)
  const [everyday, scenario] = await Promise.all([
    createAccount(request, user, { name: 'Everyday' }),
    createSampleBridgeScenario(request),
  ])
  await claimSetupToken(request, user, scenario.setupToken)
  const dialog = await openBankLink(page, user, everyday.id, 'Not linked')
  await dialog.getByRole('button', { name: 'Link bank account' }).click()
  const flow = page.getByRole('dialog', { name: 'Link bank account' })
  await flow.getByRole('radio', { name: new RegExp(`^${SAMPLE_CHEQUING}`) }).click()
  await flow.getByRole('button', { name: 'Continue' }).click()

  // The step opens with its focus inside and nothing chosen, Custom date included
  await expect(flow.getByText('Choose where history starts')).toBeVisible()
  const custom = flow.getByRole('radio', { name: /^Custom date/ })
  await expect(custom).toContainText(`Any day from ${new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${firstOfMonthsAgo(12)}T00:00:00Z`))}`)
  await expect(flow.getByRole('radio', { checked: true })).toHaveCount(0)

  const submit = flow.getByRole('button', { name: 'Link and import' })
  await custom.click()
  await expect(custom).toBeChecked()
  await expect(submit).toBeDisabled()

  const startDate = flow.getByRole('group', { name: 'Start date' })
  await startDate.getByRole('textbox', { name: 'Year' }).click()
  await page.keyboard.type('20200101')
  await expect(flow.getByText('Outside the allowed range.')).toBeVisible()
  await expect(submit).toBeDisabled()

  await startDate.getByRole('textbox', { name: 'Year' }).click()
  await page.keyboard.type(firstOfMonthsAgo(2).replaceAll('-', ''))
  await expect(flow.getByText('Outside the allowed range.')).toBeHidden()
  await expect(submit).toBeEnabled()
})

test('unlinks the account alone, then reconnects it with the relink wording', async ({ page, request }) => {
  const user = await signUpUser(request)
  const [everyday, scenario] = await Promise.all([
    createAccount(request, user, { name: 'Everyday' }),
    createSampleBridgeScenario(request),
  ])
  const connection = await claimSetupToken(request, user, scenario.setupToken)
  await linkBankAccount(request, user, {
    accountId: everyday.id,
    connectionId: connection.id,
    externalAccountId: externalIdOf(connection, SAMPLE_CHEQUING),
    startDate: todayInTestTimezone(),
  })
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${everyday.id}`)
  await page.getByRole('button', { name: /^Bank sync: / }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit Account', exact: true })
  await dialog.getByRole('button', { name: 'Unlink' }).click()

  const unlink = page.getByRole('dialog', { name: 'Unlink bank account' })
  await expect(unlink.getByText(`${SAMPLE_CHEQUING} at ${SAMPLE_BANK}`)).toBeVisible()
  await expect(unlink.getByRole('radio', { name: /^Unlink this account/ })).toBeChecked()
  await expect(unlink.getByRole('radio', { name: /^Unlink this account/ }))
    .toContainText('The connection stays in Settings, ready for this or another account to link again.')
  await expect(unlink.getByRole('radio', { name: /^Disconnect SimpleFIN/ })).not.toBeChecked()

  // Disconnect is offered too, and changes the button to match
  await unlink.getByRole('radio', { name: /^Disconnect SimpleFIN/ }).click()
  await expect(unlink.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible()
  await unlink.getByRole('radio', { name: /^Unlink this account/ }).click()
  await unlink.getByRole('button', { name: 'Unlink', exact: true }).click()

  await expect(toast(page, 'Everyday unlinked.')).toBeVisible()
  await expect(unlink).toBeHidden()
  await expect(dialog.getByText(
    `Previously linked to ${SAMPLE_CHEQUING} at ${SAMPLE_BANK} through SimpleFIN, until ${formatToday()}. Reconnecting fetches what the bank reported since then.`,
  )).toBeVisible()

  await dialog.getByRole('button', { name: 'Reconnect bank account' }).click()
  const flow = page.getByRole('dialog', { name: 'Reconnect bank account' })
  await expect(flow.getByText(`Previously linked to ${SAMPLE_CHEQUING} at ${SAMPLE_BANK}.`)).toBeVisible()
  const chequing = flow.getByRole('radio', { name: new RegExp(`^${SAMPLE_CHEQUING}`) })
  await expect(chequing).toContainText('Same account as before')
  await chequing.click()
  await flow.getByRole('button', { name: 'Continue' }).click()
  await chooseFirstStart(flow)
  await flow.getByRole('button', { name: 'Relink' }).click()

  await expect(toast(page, 'Relinked. Catching up now.')).toBeVisible()
  await expect(fact(dialog, 'Bank account')).toHaveText(SAMPLE_CHEQUING)
})

test('opens the link flow on the new account’s page when the new-account prompt chooses linking', async ({ page, request }) => {
  const user = await signUpUser(request)
  const scenario = await createSampleBridgeScenario(request)
  await claimSetupToken(request, user, scenario.setupToken)
  await logInViaApi(page, user)
  await openPage(page, '/accounts')

  const create = await openModal(page, ['Add Account', 'Add account'], 'Add Account')
  await chooseFromDropdown(create, 'Account Type', 'Checking')
  await create.getByLabel('Account Name').fill('Everyday')
  await create.getByRole('button', { name: 'Create Account' }).click()

  const prompt = page.getByRole('dialog', { name: 'Keep it up to date' })
  await expect(prompt.getByText('Everyday created')).toBeVisible()
  await expect(prompt.getByRole('radio', { name: /^Link a bank account/ })).toBeChecked()
  await expect(prompt.getByLabel('Starting balance', { exact: true })).toBeHidden()
  await prompt.getByRole('button', { name: 'Continue' }).click()

  await expect(page).toHaveURL(/\/accounts\/[0-9a-f-]+$/)
  const flow = page.getByRole('dialog', { name: 'Link bank account' })
  await expect(flow.getByText('Choose the bank account')).toBeVisible()
  await expect(flow.getByRole('radio', { name: new RegExp(`^${SAMPLE_CHEQUING}`) })).toBeVisible()

  // Closing the flow leaves the account's page, and a reload doesn't open it again
  await flow.getByRole('button', { name: 'Cancel' }).click()
  await expect(flow).toBeHidden()
  await page.reload()
  await expect(page.getByRole('button', { name: /^Bank sync: Not linked/ })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test.describe('the reason on Link bank account while bank sync is not running', () => {
  test.beforeEach(async ({ page, request }) => {
    const user = await signUpUser(request)
    const everyday = await createAccount(request, user, { name: 'Everyday' })
    await changeProviders(page, (body) => {
      body.sync_running = false
    })
    await openBankLink(page, user, everyday.id, 'Not linked')
  })

  test('shows on hover, and Escape puts it away while the modal stays open', async ({ page }) => {
    const dialog = page.getByRole('dialog', { name: 'Edit Account', exact: true })
    const link = dialog.getByRole('button', { name: 'Link bank account' })
    await expect(link).toHaveAttribute('aria-disabled', 'true')
    await expect(link).toHaveAccessibleDescription(LINKING_PAUSED)

    await link.hover()
    await expect(shownReason(page, LINKING_PAUSED)).toHaveCSS('opacity', '1')
    await page.keyboard.press('Escape')
    await expect(shownReason(page, LINKING_PAUSED)).toHaveCSS('opacity', '0')
    await expect(dialog).toBeVisible()

    // Pressing it anyway opens nothing
    await link.click({ force: true })
    await expect(page.getByRole('dialog', { name: 'Link bank account' })).toHaveCount(0)
  })

  test('shows on hover and goes once the pointer leaves', async ({ page }) => {
    const dialog = page.getByRole('dialog', { name: 'Edit Account', exact: true })
    const link = dialog.getByRole('button', { name: 'Link bank account' })
    await link.hover()
    await expect(shownReason(page, LINKING_PAUSED)).toHaveCSS('opacity', '1')
    await dialog.getByText('Link this account to one of the bank accounts').hover()
    await expect(shownReason(page, LINKING_PAUSED)).toHaveCSS('opacity', '0')
  })

  test('shows when the keyboard brings focus to it', async ({ page }) => {
    const dialog = page.getByRole('dialog', { name: 'Edit Account', exact: true })
    const link = dialog.getByRole('button', { name: 'Link bank account' })

    // Back from the Archive switch, the next control after the section, so the keyboard brings focus
    await dialog.getByRole('switch', { name: /^Archive account/ }).focus()
    await page.keyboard.press('Shift+Tab')
    await expect(link).toBeFocused()
    await expect(link).toHaveAccessibleDescription(LINKING_PAUSED)
    await expect(shownReason(page, LINKING_PAUSED)).toHaveCSS('opacity', '1')
  })
})
