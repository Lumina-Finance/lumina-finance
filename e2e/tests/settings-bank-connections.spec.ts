import { expect, test, type Locator, type Page } from '@playwright/test'

import { createAccount, signUpUser, TEST_TIMEZONE, todayInTestTimezone, type TestUser } from '../support/api'
import { chooseFromDropdown, logInViaApi, openPage } from '../support/app'
import {
  addBridgeBankAccount,
  addBridgeBankLogin,
  breakBridge,
  changeBridgeBankAccountId,
  claimSetupToken,
  createBridgeSetupToken,
  createEmptyBridgeScenario,
  createSampleBridgeScenario,
  linkBankAccount,
  requireBridgeBankSignIn,
  revokeBridgeAccess,
  waitForConnection,
} from '../support/bankSync'
import { API_BASE_URL } from '../support/target'

// The section lists the user's bank connections and looks after each one in its own modal. Connections
// are claimed from the fake SimpleFIN Bridge the instance syncs with, and the worker brings them to the
// states it reports, such as rejected or waiting on a bank sign-in. Only what a deployment decides,
// such as which providers it offers, whether its worker is running and an institution limit, is
// answered here instead
const SAMPLE_BANK = 'Harbour Bank'
const SAMPLE_CHEQUING = 'Everyday Chequing'
const SAMPLE_VISA = 'Rewards Visa'
const ADDING_PAUSED = "Bank sync isn't running right now. You can add one once it's back."
const LINKING_PAUSED = "Bank sync isn't running right now. You can link accounts once it's back."

/**
 * Today as the app shows the day a connection was added, in the zone the user signed up with
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

async function openBankConnections(page: Page, user: TestUser): Promise<Locator> {
  await logInViaApi(page, user)
  await openPage(page, '/settings#bank-connections')
  const section = page.locator('#bank-connections')
  await expect(section.getByRole('status', { name: 'Loading bank connections' })).toHaveCount(0)
  return section
}

function connectionRow(section: Locator, name: string): Locator {
  return section.getByRole('button', { name: new RegExp(`^${name}`) })
}

async function openConnection(page: Page, section: Locator, name: string): Promise<Locator> {
  await connectionRow(section, name).click()
  const dialog = page.getByRole('dialog', { name, exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

/**
 * One of the connection's facts, by its label
 */
function fact(dialog: Locator, label: string): Locator {
  return dialog.locator('dl > div').filter({ has: dialog.page().locator('dt', { hasText: label }) }).locator('dd')
}

function toast(page: Page, text: string): Locator {
  return page.getByRole('status').filter({ hasText: text })
}

/**
 * Answers the app's read of a bank sync route with the server's own answer, changed as a test needs
 * to stand for a deployment set up otherwise
 */
async function changeAnswer<T>(page: Page, path: string, change: (body: T) => void | Promise<void>): Promise<void> {
  await page.route(`${API_BASE_URL}${path}`, async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    await change(body)
    await route.fulfill({ response, json: body })
  })
}

async function changeProviders(
  page: Page,
  change: (body: { may_link: boolean; sync_running: boolean; providers: Record<string, unknown>[] }) => void | Promise<void>,
): Promise<void> {
  await changeAnswer(page, '/bank-sync/providers', change)
}

test('adds a connection with a nickname and lists it with its bank accounts', async ({ page, request }) => {
  const user = await signUpUser(request)
  const scenario = await createSampleBridgeScenario(request)
  const section = await openBankConnections(page, user)
  await expect(section.getByText('No connections yet.')).toBeVisible()

  await section.getByRole('button', { name: 'Add a connection' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add a connection' })
  await expect(dialog.getByRole('button', { name: 'Connect' })).toBeDisabled()
  await chooseFromDropdown(dialog, 'Provider', /^SimpleFIN/)
  await dialog.getByRole('textbox', { name: 'Nickname' }).fill('Joint banks')
  await dialog.getByRole('textbox', { name: 'Setup token' }).fill(scenario.setupToken)
  await dialog.getByRole('button', { name: 'Connect' }).click()

  await expect(toast(page, 'Joint banks connected with 2 bank accounts.')).toBeVisible()
  await expect(dialog).toBeHidden()
  const row = connectionRow(section, 'Joint banks')
  await expect(row).toContainText('0 of 2')
  await expect(row).toContainText(formatToday())
  await expect(row).toContainText('OK')
})

test("shows a used setup token's refusal on the token field and adds no connection", async ({ page, request }) => {
  const [user, earlierUser] = await Promise.all([signUpUser(request), signUpUser(request)])
  const scenario = await createSampleBridgeScenario(request)
  await claimSetupToken(request, earlierUser, scenario.setupToken)
  const section = await openBankConnections(page, user)

  await section.getByRole('button', { name: 'Add a connection' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add a connection' })
  const token = dialog.getByRole('textbox', { name: 'Setup token' })
  await token.fill(scenario.setupToken)
  await dialog.getByRole('button', { name: 'Connect' }).click()

  await expect(dialog.getByRole('alert')).toHaveText('This setup token has already been used. Create a new one in SimpleFIN Bridge')
  await expect(token).toHaveAttribute('aria-invalid', 'true')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(section.getByText('No connections yet.')).toBeVisible()
})

test("shows that SimpleFIN Bridge couldn't be reached beside the form's actions", async ({ page, request }) => {
  const user = await signUpUser(request)
  const scenario = await createSampleBridgeScenario(request)
  await breakBridge(request, scenario.id)
  const section = await openBankConnections(page, user)

  await section.getByRole('button', { name: 'Add a connection' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add a connection' })
  const token = dialog.getByRole('textbox', { name: 'Setup token' })
  await token.fill(scenario.setupToken)
  await dialog.getByRole('button', { name: 'Connect' }).click()

  await expect(dialog.getByRole('alert')).toHaveText("SimpleFIN Bridge couldn't be reached. Try again in a few minutes")
  await expect(token).not.toHaveAttribute('aria-invalid')
})

test('says something went wrong when adding a connection never reaches the server', async ({ page, request }) => {
  const user = await signUpUser(request)
  const scenario = await createSampleBridgeScenario(request)
  const section = await openBankConnections(page, user)
  await page.route(`${API_BASE_URL}/bank-sync/connections`, (route) =>
    route.request().method() === 'POST' ? route.abort() : route.fallback())

  await section.getByRole('button', { name: 'Add a connection' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add a connection' })
  await dialog.getByRole('textbox', { name: 'Setup token' }).fill(scenario.setupToken)
  await dialog.getByRole('button', { name: 'Connect' }).click()

  await expect(dialog.getByRole('alert')).toHaveText('Something went wrong. Please try again.')
})

test('finds connections by what their modal shows, and says when none match', async ({ page, request }) => {
  const user = await signUpUser(request)
  const [household, joint, travel] = await Promise.all([
    createAccount(request, user, { name: 'Household' }),
    createSampleBridgeScenario(request),
    createEmptyBridgeScenario(request),
  ])
  const tidewater = await addBridgeBankLogin(request, travel.id, 'Tidewater Credit Union')
  await addBridgeBankAccount(request, travel.id, { connId: tidewater, name: 'Travel Savings', currency: 'CAD' })
  const jointConnection = await claimSetupToken(request, user, joint.setupToken, 'Joint banks')
  await claimSetupToken(request, user, travel.setupToken)
  const chequing = jointConnection.accounts.find((bankAccount) => bankAccount.name === SAMPLE_CHEQUING)!
  await linkBankAccount(request, user, {
    accountId: household.id,
    connectionId: jointConnection.id,
    externalAccountId: chequing.external_id,
    startDate: todayInTestTimezone(),
  })
  const section = await openBankConnections(page, user)
  const search = section.getByPlaceholder('Search connections…')

  for (const [query, shown, hidden] of [
    ['household', 'Joint banks', 'SimpleFIN'],
    ['tidewater', 'SimpleFIN', 'Joint banks'],
    ['travel savings', 'SimpleFIN', 'Joint banks'],
    ['rewards', 'Joint banks', 'SimpleFIN'],
  ]) {
    await search.fill(query)
    await expect(connectionRow(section, shown)).toBeVisible()
    await expect(connectionRow(section, hidden)).toHaveCount(0)
  }

  await search.fill('nothing like this')
  await expect(section.getByText('No connections match your search.')).toBeVisible()
  await search.fill('')
  await expect(connectionRow(section, 'Joint banks')).toBeVisible()
  await expect(connectionRow(section, 'SimpleFIN')).toBeVisible()
})

test("renames a connection, and a blank nickname brings back the provider's name", async ({ page, request }) => {
  const user = await signUpUser(request)
  const scenario = await createSampleBridgeScenario(request)
  await claimSetupToken(request, user, scenario.setupToken)
  const section = await openBankConnections(page, user)
  const dialog = await openConnection(page, section, 'SimpleFIN')
  await expect(fact(dialog, 'Provider')).toHaveCount(0)

  await dialog.getByRole('button', { name: 'Rename' }).click()
  await dialog.getByRole('textbox', { name: 'Connection nickname' }).fill('Not kept')
  await page.keyboard.press('Escape')
  await expect(dialog.getByRole('heading', { name: 'SimpleFIN' })).toBeVisible()

  await dialog.getByRole('button', { name: 'Rename' }).click()
  await dialog.getByRole('textbox', { name: 'Connection nickname' }).fill('Joint banks')
  await page.keyboard.press('Enter')
  const renamed = page.getByRole('dialog', { name: 'Joint banks', exact: true })
  await expect(renamed.getByRole('heading', { name: 'Joint banks' })).toBeVisible()
  await expect(fact(renamed, 'Provider')).toHaveText('SimpleFIN')
  await expect(connectionRow(section, 'Joint banks')).toHaveCount(1)

  await renamed.getByRole('button', { name: 'Rename' }).click()
  await renamed.getByRole('textbox', { name: 'Connection nickname' }).fill('')
  await page.keyboard.press('Enter')
  await expect(dialog.getByRole('heading', { name: 'SimpleFIN' })).toBeVisible()
  await expect(fact(dialog, 'Provider')).toHaveCount(0)
})

test("shows a connection's facts", async ({ page, request }) => {
  const user = await signUpUser(request)
  const [household, scenario] = await Promise.all([
    createAccount(request, user, { name: 'Household' }),
    createSampleBridgeScenario(request),
  ])
  const connection = await claimSetupToken(request, user, scenario.setupToken, 'Joint banks')
  const chequing = connection.accounts.find((bankAccount) => bankAccount.name === SAMPLE_CHEQUING)!
  await linkBankAccount(request, user, {
    accountId: household.id,
    connectionId: connection.id,
    externalAccountId: chequing.external_id,
    startDate: todayInTestTimezone(),
  })
  const section = await openBankConnections(page, user)
  const dialog = await openConnection(page, section, 'Joint banks')

  await expect(dialog.getByText('Bank connection', { exact: true })).toBeVisible()
  await expect(fact(dialog, 'Status')).toHaveText('OK')
  await expect(fact(dialog, 'Provider')).toHaveText('SimpleFIN')
  await expect(fact(dialog, 'Server')).not.toBeEmpty()
  await expect(fact(dialog, 'Added')).toHaveText(formatToday())
  await expect(fact(dialog, 'Institutions linked')).toHaveText('1 · no limit')
  await expect(fact(dialog, 'Requests, 24 hours')).toHaveText(/^\d+ of 20$/)
  await expect(dialog.getByRole('region', { name: 'Institutions · 1 of 2 bank accounts linked' })).toBeVisible()
})

test('links a bank account from the connection, importing from the start chosen', async ({ page, request }) => {
  const user = await signUpUser(request)
  const [household, scenario] = await Promise.all([
    createAccount(request, user, { name: 'Household' }),
    createSampleBridgeScenario(request),
  ])
  const connection = await claimSetupToken(request, user, scenario.setupToken)
  const section = await openBankConnections(page, user)
  const dialog = await openConnection(page, section, 'SimpleFIN')

  // A lone institution starts open, with each free bank account offering the accounts that can take it
  await chooseFromDropdown(dialog, SAMPLE_CHEQUING, 'Household')
  const flow = page.getByRole('dialog', { name: 'Link bank account' })
  await expect(flow.getByText('Choose where history starts')).toBeVisible()
  await expect(flow.getByRole('button', { name: 'Cancel' })).toBeVisible()
  await expect(flow.getByRole('button', { name: 'Back' })).toHaveCount(0)
  await expect(flow.getByRole('radio', { checked: true })).toHaveCount(0)
  await expect(flow.getByRole('button', { name: 'Link and import' })).toBeDisabled()
  await flow.getByRole('radio', { name: /^3 months/ }).click()
  const linked = page.waitForRequest((sent) =>
    sent.url() === `${API_BASE_URL}/accounts/${household.id}/bank-link` && sent.method() === 'POST')
  await flow.getByRole('button', { name: 'Link and import' }).click()

  expect((await linked).postDataJSON()).toEqual({
    connection_id: connection.id,
    external_account_id: connection.accounts.find((bankAccount) => bankAccount.name === SAMPLE_CHEQUING)!.external_id,
    start_date: firstOfMonthsAgo(3),
  })
  await expect(dialog.getByRole('status').filter({ hasText: 'Linking…' })).toBeVisible()
  await expect(toast(page, 'Linked. Importing history now.')).toBeVisible()
  await expect(flow).toBeHidden()
  await expect(dialog.getByRole('link', { name: 'Household' })).toBeVisible()
  await expect(dialog.getByRole('region', { name: SAMPLE_BANK })).toContainText('1 of 2 linked')

  // The Visa is in the same currency, but Household now has a bank of its own
  await expect(dialog.getByText('No account can take it')).toBeVisible()
})

test("says which bank accounts can't be linked", async ({ page, request }) => {
  const user = await signUpUser(request)
  const [, scenario] = await Promise.all([
    createAccount(request, user, { name: 'Household' }),
    createEmptyBridgeScenario(request),
  ])
  const login = await addBridgeBankLogin(request, scenario.id, SAMPLE_BANK)
  await addBridgeBankAccount(request, scenario.id, { connId: login, name: 'US Dollar Savings', currency: 'USD' })
  await addBridgeBankAccount(request, scenario.id, { connId: login, name: 'Flight Miles', currency: 'https://www.simplefin.org/currencies/miles' })
  await claimSetupToken(request, user, scenario.setupToken)
  const section = await openBankConnections(page, user)
  const dialog = await openConnection(page, section, 'SimpleFIN')

  const usd = dialog.getByRole('listitem').filter({ hasText: 'US Dollar Savings' })
  await expect(usd).toContainText('No account can take it')
  await expect(usd.getByRole('combobox')).toHaveCount(0)
  const miles = dialog.getByRole('listitem').filter({ hasText: 'Flight Miles' })
  await expect(miles).toContainText('Custom currency')
  await expect(miles).toContainText("Can't be linked")
})

test('disconnects after asking again, then focuses the next connection', async ({ page, request }) => {
  const user = await signUpUser(request)
  const [household, joint, travel] = await Promise.all([
    createAccount(request, user, { name: 'Household' }),
    createSampleBridgeScenario(request),
    createSampleBridgeScenario(request),
  ])
  const connection = await claimSetupToken(request, user, joint.setupToken, 'Joint banks')
  await claimSetupToken(request, user, travel.setupToken, 'Travel cards')
  await linkBankAccount(request, user, {
    accountId: household.id,
    connectionId: connection.id,
    externalAccountId: connection.accounts.find((bankAccount) => bankAccount.name === SAMPLE_CHEQUING)!.external_id,
    startDate: todayInTestTimezone(),
  })
  const section = await openBankConnections(page, user)
  const dialog = await openConnection(page, section, 'Joint banks')

  await dialog.getByRole('button', { name: 'Disconnect' }).click()
  await expect(dialog.getByRole('button', { name: 'Yes, disconnect' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Yes, disconnect' }).click()

  await expect(toast(page, 'Joint banks disconnected. 1 account unlinked.')).toBeVisible()
  await expect(dialog).toBeHidden()
  await expect(connectionRow(section, 'Joint banks')).toHaveCount(0)
  await expect(connectionRow(section, 'Travel cards')).toBeFocused()
})

test('focuses the connection before a disconnected last one', async ({ page, request }) => {
  const user = await signUpUser(request)
  const [joint, travel] = await Promise.all([createSampleBridgeScenario(request), createSampleBridgeScenario(request)])
  await claimSetupToken(request, user, joint.setupToken, 'Joint banks')
  await claimSetupToken(request, user, travel.setupToken, 'Travel cards')
  const section = await openBankConnections(page, user)
  const dialog = await openConnection(page, section, 'Travel cards')

  await dialog.getByRole('button', { name: 'Disconnect' }).click()
  await dialog.getByRole('button', { name: 'Yes, disconnect' }).click()

  await expect(dialog).toBeHidden()
  await expect(connectionRow(section, 'Joint banks')).toBeFocused()
})

test('focuses the search once the only connection is disconnected', async ({ page, request }) => {
  const user = await signUpUser(request)
  const scenario = await createSampleBridgeScenario(request)
  await claimSetupToken(request, user, scenario.setupToken)
  const section = await openBankConnections(page, user)
  const dialog = await openConnection(page, section, 'SimpleFIN')

  await dialog.getByRole('button', { name: 'Disconnect' }).click()
  await dialog.getByRole('button', { name: 'Yes, disconnect' }).click()

  await expect(dialog).toBeHidden()
  await expect(section.getByText('No connections yet.')).toBeVisible()
  await expect(section.getByPlaceholder('Search connections…')).toBeFocused()
})

test('reconnects a rejected connection, and shows the account to choose again under Mismatch detected', async ({ page, request }) => {
  const user = await signUpUser(request)
  const [household, travelVisa, scenario] = await Promise.all([
    createAccount(request, user, { name: 'Household' }),
    createAccount(request, user, { name: 'Travel Visa', accountKind: 'revolving', accountType: 'credit_card' }),
    createSampleBridgeScenario(request),
  ])
  const connection = await claimSetupToken(request, user, scenario.setupToken)
  const visa = connection.accounts.find((bankAccount) => bankAccount.name === SAMPLE_VISA)!

  // Linking queues each import without asking the Bridge, so the worker meets the revoked access
  await revokeBridgeAccess(request, scenario.id)
  for (const [accountId, bankAccount] of [[household.id, SAMPLE_CHEQUING], [travelVisa.id, SAMPLE_VISA]]) {
    await linkBankAccount(request, user, {
      accountId,
      connectionId: connection.id,
      externalAccountId: connection.accounts.find((entry) => entry.name === bankAccount)!.external_id,
      startDate: todayInTestTimezone(),
    })
  }
  await waitForConnection(request, user, connection.id, (current) => current.status === 'credential_rejected')

  // SimpleFIN lists the Visa differently after the reconnect, so its account has to choose it again
  await changeBridgeBankAccountId(request, scenario.id, visa.external_id, `${visa.external_id}-relisted`)
  const section = await openBankConnections(page, user)
  await expect(connectionRow(section, 'SimpleFIN')).toContainText('Reconnect needed')
  const dialog = await openConnection(page, section, 'SimpleFIN')
  await expect(fact(dialog, 'Status')).toHaveText('Reconnect needed')
  await expect(dialog.getByText('SimpleFIN rejected this connection')).toBeVisible()
  await expect(dialog.getByRole('searchbox', { name: 'Find an institution' })).toHaveCount(0)
  const folded = dialog.getByRole('region', { name: '1 institution', exact: true })
  await expect(folded).toContainText('Linking resumes after you reconnect')
  await expect(folded).toContainText('2 of 2 linked')
  await folded.getByRole('button', { name: /^1 institution/ }).click()
  await expect(dialog.getByRole('link', { name: 'Household' })).toBeVisible()

  await dialog.getByRole('button', { name: 'Reconnect', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'Reconnect SimpleFIN' })
  await expect(form.getByText('SimpleFIN Bridge no longer accepts this connection.')).toBeVisible()
  await expect(form.getByRole('combobox', { name: 'Provider' })).toHaveCount(0)
  await form.getByRole('textbox', { name: 'Setup token' }).fill(await createBridgeSetupToken(request, scenario.id))
  await form.getByRole('button', { name: 'Reconnect', exact: true }).click()

  await expect(toast(page, '1 account resumes syncing.')).toBeVisible()
  await expect(form).toBeHidden()
  await expect(fact(dialog, 'Status')).toHaveText('OK')
  await expect(dialog.getByText('Needs attention')).toBeVisible()
  await expect(dialog.getByText('All good')).toBeVisible()
  const mismatch = dialog.getByRole('region', { name: 'Mismatch detected' })
  await expect(mismatch).toContainText('Choose bank account')
  await expect(mismatch).toContainText(`Was ${SAMPLE_VISA}`)
  await expect(mismatch.getByRole('link', { name: 'Travel Visa' })).toBeVisible()
  await mismatch.getByRole('button', { name: 'Why this happened' }).click()
  await expect(mismatch.getByText(`SimpleFIN now lists ${SAMPLE_VISA} differently`)).toBeVisible()
})

test('shows a bank that needs signing in to on the connection and its institution', async ({ page, request }) => {
  const user = await signUpUser(request)
  const [household, scenario] = await Promise.all([
    createAccount(request, user, { name: 'Household' }),
    createEmptyBridgeScenario(request),
  ])
  const login = await addBridgeBankLogin(request, scenario.id, SAMPLE_BANK)
  await addBridgeBankAccount(request, scenario.id, { connId: login, name: SAMPLE_CHEQUING, currency: 'CAD' })
  const connection = await claimSetupToken(request, user, scenario.setupToken)

  // The import the link queues meets the bank login's problem
  await requireBridgeBankSignIn(request, scenario.id, login)
  await linkBankAccount(request, user, {
    accountId: household.id,
    connectionId: connection.id,
    externalAccountId: connection.accounts[0].external_id,
    startDate: todayInTestTimezone(),
  })
  await waitForConnection(request, user, connection.id, (current) => current.accounts.some((bankAccount) => bankAccount.signin_needed))
  const section = await openBankConnections(page, user)

  await expect(connectionRow(section, 'SimpleFIN')).toContainText('Bank sign-in needed')
  const dialog = await openConnection(page, section, 'SimpleFIN')
  await expect(fact(dialog, 'Status')).toContainText('Bank sign-in needed')
  await dialog.getByRole('button', { name: 'Status details' }).click()
  await expect(dialog.getByText(`Sign in to ${SAMPLE_BANK} again`)).toBeVisible()
  await expect(dialog.getByRole('region', { name: SAMPLE_BANK })).toContainText('Sign in again in SimpleFIN Bridge')
})

test('searches the institutions of a connection with more than 5, and Escape clears the search first', async ({ page, request }) => {
  const user = await signUpUser(request)
  const scenario = await createEmptyBridgeScenario(request)
  const banks = ['Alder Bank', 'Birch Credit Union', 'Cedar Trust', 'Douglas Savings', 'Elm Bank', 'Fir Financial']
  for (const [index, bank] of banks.entries()) {
    const login = await addBridgeBankLogin(request, scenario.id, bank)
    await addBridgeBankAccount(request, scenario.id, { connId: login, name: index === 5 ? 'Travel Savings' : `${bank} Chequing`, currency: 'CAD' })
  }
  await claimSetupToken(request, user, scenario.setupToken)
  const section = await openBankConnections(page, user)
  const dialog = await openConnection(page, section, 'SimpleFIN')
  const search = dialog.getByRole('searchbox', { name: 'Find an institution' })

  await search.fill('cedar')
  await expect(dialog.getByRole('region', { name: 'Cedar Trust' })).toBeVisible()
  await expect(dialog.getByRole('region', { name: 'Alder Bank' })).toHaveCount(0)
  await search.fill('travel')
  await expect(dialog.getByRole('region', { name: 'Fir Financial' })).toBeVisible()
  await expect(dialog.getByRole('region', { name: 'Cedar Trust' })).toHaveCount(0)
  await search.fill('zzz')
  await expect(dialog.getByText('No institutions match “zzz”.')).toBeVisible()

  await search.press('Escape')
  await expect(search).toHaveValue('')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('region', { name: 'Alder Bank' })).toBeVisible()
  await search.press('Escape')
  await expect(dialog).toBeHidden()
})

test('counts institutions against a limit and stops linking a new one once it is reached', async ({ page, request }) => {
  const user = await signUpUser(request)
  const [, scenario] = await Promise.all([
    createAccount(request, user, { name: 'Household' }),
    createSampleBridgeScenario(request),
  ])
  await claimSetupToken(request, user, scenario.setupToken)
  await changeProviders(page, (body) => {
    body.providers[0].institution_limit = 1
    body.providers[0].institutions_in_use = ['Northshore Bank']
  })
  // With the limit reached, the server offers no account for a bank account at a new institution
  await changeAnswer<{ accounts: { eligible_account_ids: string[] }[] }[]>(page, '/bank-sync/connections', (connections) => {
    for (const bankAccount of connections.flatMap((connection) => connection.accounts)) bankAccount.eligible_account_ids = []
  })
  const section = await openBankConnections(page, user)
  const dialog = await openConnection(page, section, 'SimpleFIN')

  await expect(fact(dialog, 'Institutions linked')).toHaveText('1 of 1')
  const harbour = dialog.getByRole('region', { name: SAMPLE_BANK })
  await expect(harbour).toContainText('Linking here would go over your limit of 1 institution.')
  await expect(harbour.getByRole('combobox', { name: SAMPLE_CHEQUING })).toBeDisabled()
  await expect(harbour.getByText('No account can take it')).toHaveCount(0)
})

test("holds adding and linking back with the reason while bank sync isn't running, leaving the other actions", async ({ page, request }) => {
  const user = await signUpUser(request)
  const [, scenario] = await Promise.all([
    createAccount(request, user, { name: 'Household' }),
    createSampleBridgeScenario(request),
  ])
  await claimSetupToken(request, user, scenario.setupToken)
  await changeProviders(page, (body) => {
    body.sync_running = false
  })
  const section = await openBankConnections(page, user)
  const add = section.getByRole('button', { name: 'Add a connection' })

  await expect(add).toHaveAttribute('aria-disabled', 'true')
  await expect(add).toHaveAccessibleDescription(ADDING_PAUSED)
  // Forced, since Playwright waits for a control marked unavailable to become available before pressing it
  await add.click({ force: true })
  await expect(page.getByRole('dialog', { name: 'Add a connection' })).toHaveCount(0)

  const dialog = await openConnection(page, section, 'SimpleFIN')
  const chequing = dialog.getByRole('combobox', { name: SAMPLE_CHEQUING })
  await expect(chequing).toHaveAttribute('aria-disabled', 'true')
  await expect(chequing).toHaveAccessibleDescription(LINKING_PAUSED)
  await chequing.click({ force: true })
  await expect(chequing).toHaveAttribute('aria-expanded', 'false')
  await expect(dialog.getByRole('button', { name: 'Rename' })).toBeEnabled()
  await expect(dialog.getByRole('button', { name: 'Disconnect' })).toBeEnabled()
})

test('holds Link and import back with the reason when bank sync stops as the link flow opens', async ({ page, request }) => {
  const user = await signUpUser(request)
  const [household, scenario] = await Promise.all([
    createAccount(request, user, { name: 'Household' }),
    createSampleBridgeScenario(request),
  ])
  await claimSetupToken(request, user, scenario.setupToken)
  // The flow reads the providers again as it opens, and finds the worker down from then on
  await changeProviders(page, async (body) => {
    body.sync_running = (await page.locator('#bank-link-title').count()) === 0
  })
  let linkRequests = 0
  page.on('request', (sent) => {
    if (sent.url() === `${API_BASE_URL}/accounts/${household.id}/bank-link` && sent.method() === 'POST') linkRequests += 1
  })
  const section = await openBankConnections(page, user)
  const dialog = await openConnection(page, section, 'SimpleFIN')

  await chooseFromDropdown(dialog, SAMPLE_CHEQUING, 'Household')
  const flow = page.getByRole('dialog', { name: 'Link bank account' })
  await flow.getByRole('radio', { name: /^3 months/ }).click()
  const submit = flow.getByRole('button', { name: 'Link and import' })
  await expect(submit).toHaveAttribute('aria-disabled', 'true')
  await expect(submit).toHaveAccessibleDescription(LINKING_PAUSED)
  await submit.click({ force: true })
  await expect(flow).toBeVisible()
  expect(linkRequests).toBe(0)
})

test('disables Add a connection when no provider is open to new connections', async ({ page, request }) => {
  const user = await signUpUser(request)
  await changeProviders(page, (body) => {
    for (const provider of body.providers) provider.offered = false
  })
  const section = await openBankConnections(page, user)

  await expect(section.getByRole('button', { name: 'Add a connection' })).toBeDisabled()
  await expect(section.getByText('No bank provider is open to new connections right now. Existing connections keep working.')).toBeVisible()
})

test("says why Add a connection is held back when the bank providers can't load", async ({ page, request }) => {
  const user = await signUpUser(request)
  await page.route(`${API_BASE_URL}/bank-sync/providers`, (route) => route.fulfill({ status: 500, body: '' }))
  const section = await openBankConnections(page, user)
  const add = section.getByRole('button', { name: 'Add a connection' })

  await expect(add).toHaveAttribute('aria-disabled', 'true')
  await expect(add).toHaveAccessibleDescription('Bank providers could not load. Reload the page to try again.')
})

test("shows the failure when the connections can't load, rather than an empty list", async ({ page, request }) => {
  const user = await signUpUser(request)
  await page.route(`${API_BASE_URL}/bank-sync/connections`, (route) => route.fulfill({ status: 500, body: '' }))
  await logInViaApi(page, user)
  await openPage(page, '/settings#bank-connections')
  const section = page.locator('#bank-connections')

  await expect(section.getByRole('alert')).toContainText('Bank connections could not load')
  await expect(section.getByText('No connections yet.')).toHaveCount(0)
})

test('leaves the section out for a user who may not link bank accounts', async ({ page, request }) => {
  const user = await signUpUser(request)
  await changeProviders(page, (body) => {
    body.may_link = false
  })
  await logInViaApi(page, user)
  await openPage(page, '/settings')

  await expect(page.locator('#runway')).toBeVisible()
  await expect(page.locator('#bank-connections')).toHaveCount(0)

  // Narrower than the sidebar's width, the sections are listed only once the compact menu opens
  const compactMenu = page.locator('button[aria-controls="settings-mobile-section-menu"]')
  if (await compactMenu.isVisible()) await compactMenu.click()
  const sections = page.getByRole('navigation', { name: 'Settings sections' })
  await expect(sections.getByRole('button', { name: 'Runway' })).toBeVisible()
  await expect(sections.getByRole('button', { name: 'Bank connections' })).toHaveCount(0)
})
