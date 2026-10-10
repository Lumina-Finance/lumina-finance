import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import { asUser, createAccount, formatToday, signUpUser, todayInTestTimezone, type TestUser } from '../support/api'
import { chooseFromDropdown, logInViaApi, openPage, watchServerRequests } from '../support/app'
import {
  addBridgeBankAccount,
  addBridgeBankLogin,
  breakBridge,
  changeBridgeBankAccountId,
  changeProviders,
  claimSetupToken,
  createBridgeSetupToken,
  createEmptyBridgeScenario,
  createSampleBridgeScenario,
  errorToast,
  isRead,
  linkBankAccount,
  requireBridgeBankSignIn,
  revokeBridgeAccess,
  waitForConnection,
  WORKER_RESULT_TIMEOUT_MS,
  type SeededConnection,
} from '../support/bankSync'
import { expectMessageInCorner, readBoxes } from '../support/selectors'
import { API_BASE_URL } from '../support/target'

// The section lists the user's bank connections and looks after each one in its own modal. Connections
// are claimed from the fake SimpleFIN Bridge the instance syncs with, and the worker brings them to the
// states it reports, such as rejected or waiting on a bank sign-in. Only what a deployment decides,
// such as which providers it offers, whether its worker is running and an institution limit, and a
// request budget spent as the page's clock starts, are answered here instead
const SAMPLE_BANK = 'Harbour Bank'
const SAMPLE_CHEQUING = 'Everyday Chequing'
const SAMPLE_VISA = 'Rewards Visa'
const ADDING_PAUSED = "Bank sync isn't running right now. You can add one once it's back."
const LINKING_PAUSED = "Bank sync isn't running right now. You can link accounts once it's back."

// A sideways swipe well past the 16px the status's closed note reaches beyond the facts column's edge
const SIDEWAYS_SWIPE_PX = 40

// How long after a spent request budget a request frees up, and how long the connection stays open
// meanwhile, long enough for the wait it gives to count down
const REQUEST_FREES_UP_AFTER_MS = 10 * 60 * 1000
const BUDGET_OPEN_MS = 5 * 60 * 1000

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
 * Where an open note stands, read at one instant: wholly inside the box that cuts off whatever leaves
 * it, and clear of the value it explains
 */
async function placeOfNote(note: Locator, clip: Locator, value: Locator): Promise<{ inFull: boolean; clearOfValue: boolean }> {
  const [box, bounds, explained] = await readBoxes(note.page(), [note, clip, value])
  return {
    inFull: box.x >= bounds.x
      && box.y >= bounds.y
      && box.x + box.width <= bounds.x + bounds.width
      && box.y + box.height <= bounds.y + bounds.height,
    clearOfValue: box.y + box.height <= explained.y
      || box.y >= explained.y + explained.height
      || box.x + box.width <= explained.x
      || box.x >= explained.x + explained.width,
  }
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

/**
 * Claims a connection to Harbour Bank whose bank login needs signing in again, which the import a
 * link to Household queues finds, so its status reads Bank sign-in needed with a note beside it
 */
async function claimConnectionNeedingSignIn(request: APIRequestContext, user: TestUser): Promise<void> {
  const [household, scenario] = await Promise.all([
    createAccount(request, user, { name: 'Household' }),
    createEmptyBridgeScenario(request),
  ])
  const login = await addBridgeBankLogin(request, scenario.id, SAMPLE_BANK)
  await addBridgeBankAccount(request, scenario.id, { connId: login, name: SAMPLE_CHEQUING, currency: 'CAD' })
  const connection = await claimSetupToken(request, user, scenario.setupToken)

  await requireBridgeBankSignIn(request, scenario.id, login)
  await linkBankAccount(request, user, {
    accountId: household.id,
    connectionId: connection.id,
    externalAccountId: connection.accounts[0].external_id,
    startDate: todayInTestTimezone(),
  })
  await waitForConnection(request, user, connection.id, (current) => current.accounts.some((bankAccount) => bankAccount.signin_needed))
}

// A read the page sends as a test ends can still be on its way through a changed answer when the page
// closes, which would fail a test whose checks all passed
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

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

// A rename on its way holds the modal open, as a disconnect does, so word that it failed comes beside the
// connection it was for. The rename is held here until the modal has been asked to close, then fails
test('keeps the modal open while a rename is on its way, saying there if it fails', async ({ page, request }) => {
  const user = await signUpUser(request)
  const scenario = await createSampleBridgeScenario(request)
  await claimSetupToken(request, user, scenario.setupToken)
  const isRename = (url: URL) => /\/bank-sync\/connections\/[^/]+$/.test(url.pathname)
  let failRename = () => {}
  const renameFails = new Promise<void>((resolve) => { failRename = resolve })
  await page.route(isRename, async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback()
    await renameFails
    await route.abort('failed')
  })
  const section = await openBankConnections(page, user)
  const dialog = await openConnection(page, section, 'SimpleFIN')

  await dialog.getByRole('button', { name: 'Rename' }).click()
  await dialog.getByRole('textbox', { name: 'Connection nickname' }).fill('Joint banks')
  const renameSent = page.waitForRequest((sent) => sent.method() === 'PATCH' && isRename(new URL(sent.url())))
  await page.keyboard.press('Enter')
  await renameSent
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeDisabled()
  await page.keyboard.press('Escape')

  failRename()
  await expect(errorToast(page, 'Could not rename this connection. Please try again.')).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: 'Connection nickname' })).toHaveValue('Joint banks')
  await expect(connectionRow(section, 'SimpleFIN')).toHaveCount(1)
})

// The field fades out once its rename is saved, which is too short a while to catch by polling, so the
// dialog's look is read after every change to it, from the save going out until the field has gone
test('stops Save spinning as soon as a rename is saved and the modal can close again', async ({ page, request }) => {
  const user = await signUpUser(request)
  const scenario = await createSampleBridgeScenario(request)
  await claimSetupToken(request, user, scenario.setupToken)
  const section = await openBankConnections(page, user)
  const dialog = await openConnection(page, section, 'SimpleFIN')
  await dialog.getByRole('button', { name: 'Rename' }).click()
  await dialog.getByRole('textbox', { name: 'Connection nickname' }).fill('Joint banks')

  await dialog.evaluate((panel) => {
    const looks: string[] = []
    const observedWindow = window as Window & { __renameLooks?: string[] }
    observedWindow.__renameLooks = looks
    // Save counts as spinning while it is marked busy. Its spinner fades out after that, which the label
    // swap keeps drawing for a moment, so the spinner is checked once the field has gone
    const read = () => {
      const close = panel.querySelector('button[aria-label="Close"]') as HTMLButtonElement
      const save = panel.querySelector('button[aria-label="Save nickname"]')
      const spinning = save !== null && save.getAttribute('aria-busy') === 'true'
      return `close ${close.disabled ? 'disabled' : 'enabled'}, save ${spinning ? 'spinning' : 'still'}`
    }
    looks.push(read())
    new MutationObserver(() => {
      const look = read()
      if (looks.at(-1) !== look) looks.push(look)
    }).observe(panel, { childList: true, subtree: true, attributes: true })
  })
  await page.keyboard.press('Enter')
  const renamed = page.getByRole('dialog', { name: 'Joint banks', exact: true })
  await expect(renamed.getByRole('heading', { name: 'Joint banks' })).toBeVisible()
  await expect(renamed.getByRole('textbox', { name: 'Connection nickname' })).toHaveCount(0)
  // Read once, since Save has left with the field and a spinner still drawn then is the failure
  expect(await renamed.locator('.app-spinner').count()).toBe(0)

  const looks = await page.evaluate(() => (window as Window & { __renameLooks?: string[] }).__renameLooks)
  expect(looks).toContain('close disabled, save spinning')
  expect(looks).not.toContain('close enabled, save spinning')
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

test('words when a spent request budget frees up anew as minutes pass with the connection open', async ({ page, request }) => {
  const user = await signUpUser(request)
  const scenario = await createSampleBridgeScenario(request)
  await claimSetupToken(request, user, scenario.setupToken, 'Joint banks')
  const spentAt = new Date()
  const availableAgainAt = new Date(spentAt.getTime() + REQUEST_FREES_UP_AFTER_MS).toISOString()
  await page.route(isRead('/bank-sync/connections'), async (route) => {
    const response = await route.fetch()
    const connections = (await response.json() as SeededConnection[]).map((connection) => ({
      ...connection,
      request_budget: { ...connection.request_budget, used: connection.request_budget.limit, available_again_at: availableAgainAt },
    }))
    await route.fulfill({ response, json: connections })
  })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.install({ time: spentAt })
  const allLanded = watchServerRequests(page)
  const section = await openBankConnections(page, user)
  const dialog = await openConnection(page, section, 'Joint banks')
  const trigger = dialog.getByRole('button', { name: 'About requests, 24 hours' })
  const note = dialog.locator('.app-tooltip-panel').filter({ hasText: /^Lumina Finance makes up to/ })

  // The dialog grows into place as it opens, and a press aimed at the icon before it has settled
  // lands beside it
  await expect(dialog).toHaveCSS('transform', 'none')
  await trigger.click()
  await expect(note).toContainText(/frees up in 10 minutes/)
  await trigger.click()
  await page.mouse.move(0, 0)

  await allLanded()
  await page.clock.runFor(BUDGET_OPEN_MS)
  await trigger.click()
  await expect(note).toContainText(/frees up in 5 minutes/)
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
  // The connection fills the screen on a phone but has no footer, so the message stays in the corner
  await expectMessageInCorner(toast(page, 'Linked. Importing history now.'))
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
  const linkTo = (accountId: string, bankAccount: string) => linkBankAccount(request, user, {
    accountId,
    connectionId: connection.id,
    externalAccountId: connection.accounts.find((entry) => entry.name === bankAccount)!.external_id,
    startDate: todayInTestTimezone(),
  })

  // A rejected connection takes no new link, so the Visa links first and its import ends while SimpleFIN
  // still accepts the connection. Linking queues Household's import without asking the Bridge, so that
  // import is the one job left to meet the revoked access, and it can only run once Household is linked
  await linkTo(travelVisa.id, SAMPLE_VISA)
  await expect.poll(async () => {
    const response = await request.get(`${API_BASE_URL}/accounts/${travelVisa.id}/bank-link`, { headers: asUser(user) })
    return ((await response.json()) as { link: { sync: { last_success_at: string | null } } }).link.sync.last_success_at
  }, { timeout: WORKER_RESULT_TIMEOUT_MS }).not.toBeNull()
  await revokeBridgeAccess(request, scenario.id)
  await linkTo(household.id, SAMPLE_CHEQUING)
  await waitForConnection(request, user, connection.id, (current) => current.status === 'credential_rejected')

  // SimpleFIN lists the Visa differently after the reconnect, so its account has to choose it again
  await changeBridgeBankAccountId(request, scenario.id, visa.external_id, `${visa.external_id}-relisted`)
  const section = await openBankConnections(page, user)
  await expect(connectionRow(section, 'SimpleFIN')).toContainText('Reconnect needed')
  const dialog = await openConnection(page, section, 'SimpleFIN')
  await expect(fact(dialog, 'Status')).toHaveText('Reconnect needed')
  await expect(dialog.getByText('SimpleFIN rejected this connection')).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: 'Find an institution' })).toHaveCount(0)
  const folded = dialog.getByRole('region', { name: '1 institution', exact: true })
  // One line, beside the name from 640px and under it on phones, so exactly one copy shows at any width
  await expect(folded.getByText('2 of 2 linked · Linking resumes after you reconnect', { exact: true }).filter({ visible: true })).toHaveCount(1)
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
  await claimConnectionNeedingSignIn(request, user)
  const section = await openBankConnections(page, user)

  await expect(connectionRow(section, 'SimpleFIN')).toContainText('Bank sign-in needed')
  const dialog = await openConnection(page, section, 'SimpleFIN')
  await expect(fact(dialog, 'Status')).toContainText('Bank sign-in needed')
  await dialog.getByRole('button', { name: 'Status details' }).click()
  await expect(dialog.getByText(`Sign in to ${SAMPLE_BANK} again`)).toBeVisible()
  await expect(dialog.getByRole('region', { name: SAMPLE_BANK })).toContainText('Sign in again in SimpleFIN Bridge')
})

test("lists the connection's facts one to a row beside its institutions from 1050px, and two to a row below", async ({ page, request }) => {
  const user = await signUpUser(request)
  const scenario = await createSampleBridgeScenario(request)
  await claimSetupToken(request, user, scenario.setupToken)
  // The narrowest width that sets the connection's own pane beside its institutions
  await page.setViewportSize({ width: 1050, height: page.viewportSize()!.height })
  const section = await openBankConnections(page, user)
  const dialog = await openConnection(page, section, 'SimpleFIN')
  const status = fact(dialog, 'Status')
  const server = fact(dialog, 'Server')
  // Polled, since the modal is still settling in as it opens
  const layout = async () => {
    const [first, second] = await Promise.all([status.boundingBox(), server.boundingBox()])
    if (!first || !second) return 'hidden'
    if (Math.abs(first.x - second.x) < 1 && second.y > first.y) return 'one to a row'
    if (Math.abs(first.y - second.y) < 1 && second.x > first.x) return 'two to a row'
    return 'neither'
  }

  await expect.poll(layout).toBe('one to a row')
  await page.setViewportSize({ width: 1049, height: page.viewportSize()!.height })
  await expect.poll(layout).toBe('two to a row')
})

test("opens every note beside a connection's facts in full and clear of the fact's value, stacked or in the column", async ({ page, request }) => {
  test.skip(test.info().project.name !== 'desktop', 'It sets its own window sizes')
  const user = await signUpUser(request)

  // A bank login waiting on a sign-in gives the status a note too, beside the two facts that always have one
  await claimConnectionNeedingSignIn(request, user)
  const notes = [
    { icon: 'Status details', label: 'Status', text: new RegExp(`^Sign in to ${SAMPLE_BANK} again`) },
    { icon: 'About institutions linked', label: 'Institutions linked', text: /^Counts each institution/ },
    { icon: 'About requests, 24 hours', label: 'Requests, 24 hours', text: /^Lumina Finance makes up to/ },
  ]

  // From 1050px the facts are a column beside the institutions, which scrolls and so cuts off whatever
  // leaves it. The sidebar's edge behind the dialog lies inside the column at both widths, but a note
  // held right of it would still fit the column at 1440px and doesn't at 1050px. Below 1050px the facts
  // are stacked above the institutions, two to a row, and the dialog is what cuts a note off
  const sizes = [
    { width: 1050, height: 800, clippedBy: 'column' },
    { width: 1440, height: 900, clippedBy: 'column' },
    { width: 768, height: 1024, clippedBy: 'dialog' },
  ] as const
  await page.setViewportSize(sizes[0])
  const section = await openBankConnections(page, user)
  const dialog = await openConnection(page, section, 'SimpleFIN')

  // The dialog grows into place as it opens, and a press aimed at an icon before it has settled lands
  // beside the icon by the time it arrives, leaving the note closed
  await expect(dialog).toHaveCSS('transform', 'none')
  for (const { clippedBy, ...size } of sizes) {
    await page.setViewportSize(size)
    const clip = clippedBy === 'column' ? dialog.getByRole('complementary') : dialog
    for (const { icon, label, text } of notes) {
      const trigger = dialog.getByRole('button', { name: icon })
      await trigger.click()
      // The note is placed in the same update that opens it
      await expect(trigger).toHaveAttribute('aria-expanded', 'true')
      const note = dialog.locator('.app-tooltip-panel').filter({ hasText: text })
      await expect.poll(() => placeOfNote(note, clip, fact(dialog, label)), {
        message: `${icon} at ${size.width}x${size.height}`,
      }).toEqual({ inFull: true, clearOfValue: true })

      // Closed again with the pointer off it, so it never covers the next icon
      await trigger.click()
      await page.mouse.move(0, 0)
    }
  }
})

test("keeps a connection's facts column from scrolling sideways, so the status note's icon stays under the pointer", async ({ page, request }) => {
  test.skip(test.info().project.name !== 'desktop', 'The facts sit in a column beside the institutions from 1050px, which one width shows')
  const user = await signUpUser(request)

  // Only the status's note, opening from after the longest status, reaches past the column's edge while closed
  await claimConnectionNeedingSignIn(request, user)
  const section = await openBankConnections(page, user)
  const dialog = await openConnection(page, section, 'SimpleFIN')
  await expect(dialog).toHaveCSS('transform', 'none')
  const column = dialog.getByRole('complementary')
  const icon = dialog.getByRole('button', { name: 'Status details' })
  const atRest = (await icon.boundingBox())!

  // A trackpad swipe across the column, further than the closed note reaches past its edge. The
  // gesture has played out once the browser answers, and the column has scrolled by the next frame
  const columnBox = (await column.boundingBox())!
  const browser = await page.context().newCDPSession(page)
  await browser.send('Input.synthesizeScrollGesture', {
    x: columnBox.x + columnBox.width / 2,
    y: columnBox.y + columnBox.height / 2,
    xDistance: -SIDEWAYS_SWIPE_PX,
    yDistance: 0,
    gestureSourceType: 'mouse',
  })
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  expect(await icon.boundingBox()).toEqual(atRest)
})

test("opens a fact's note below its value where the dialog leaves no room above the fact", async ({ page, request }) => {
  test.skip(test.info().project.name !== 'desktop', 'It sets its own window size')
  const user = await signUpUser(request)
  const scenario = await createSampleBridgeScenario(request)
  await claimSetupToken(request, user, scenario.setupToken)

  // A phone on its side, where the facts are stacked above the institutions and the dialog scrolls
  await page.setViewportSize({ width: 844, height: 390 })
  const section = await openBankConnections(page, user)
  const dialog = await openConnection(page, section, 'SimpleFIN')
  await expect(dialog).toHaveCSS('transform', 'none')

  // Scrolled until the fact is at the top of the dialog, or as near as the dialog goes
  const value = fact(dialog, 'Institutions linked')
  await value.evaluate((element) => element.parentElement!.scrollIntoView({ block: 'start', behavior: 'instant' }))
  const trigger = dialog.getByRole('button', { name: 'About institutions linked' })
  await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')

  const note = dialog.locator('.app-tooltip-panel').filter({ hasText: /^Counts each institution/ })
  await expect.poll(() => placeOfNote(note, dialog, value)).toEqual({ inFull: true, clearOfValue: true })

  // Below the value, since above the fact it would run off the dialog's top
  const [opened, explained] = await readBoxes(page, [note, value])
  expect(opened.y).toBeGreaterThanOrEqual(explained.y + explained.height)
})

test('cuts a long institution name short before its count, keeping the whole name', async ({ page, request }) => {
  const user = await signUpUser(request)
  const scenario = await createEmptyBridgeScenario(request)
  // Longer than the institutions pane at every width
  const bank = 'Northern Coastal Fishing, Forestry and Mining Workers Cooperative Credit Union of the Greater Lakeshore and Harbour Region'
  const login = await addBridgeBankLogin(request, scenario.id, bank)
  await addBridgeBankAccount(request, scenario.id, { connId: login, name: SAMPLE_CHEQUING, currency: 'CAD' })
  await claimSetupToken(request, user, scenario.setupToken)
  const section = await openBankConnections(page, user)
  const dialog = await openConnection(page, section, 'SimpleFIN')
  const institution = dialog.getByRole('region', { name: bank })
  const name = institution.getByRole('button', { name: bank })
  const count = institution.getByText('0 of 1 linked', { exact: true })

  await expect(count).toBeVisible()
  const [nameBox, countBox] = await Promise.all([name.boundingBox(), count.boundingBox()])
  expect(nameBox!.x + nameBox!.width).toBeLessThanOrEqual(countBox!.x)
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
  // The app's own search field, a plain text field, so the browser draws no clear button of its own
  // beside the modal's close
  const search = dialog.getByRole('textbox', { name: 'Find an institution' })

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
  // The worker runs until the test stops it just before the flow opens, which reads the providers again
  let workerStopped = false
  await changeProviders(page, (body) => {
    body.sync_running = !workerStopped
  })
  let providersReadsPending = 0
  const countProvidersRead = (sent: { url: () => string }, change: number) => {
    if (sent.url() === `${API_BASE_URL}/bank-sync/providers`) providersReadsPending += change
  }
  page.on('request', (sent) => countProvidersRead(sent, 1))
  page.on('requestfinished', (sent) => countProvidersRead(sent, -1))
  page.on('requestfailed', (sent) => countProvidersRead(sent, -1))
  const section = await openBankConnections(page, user)
  const dialog = await openConnection(page, section, 'SimpleFIN')

  await dialog.getByRole('combobox', { name: SAMPLE_CHEQUING }).click()
  // A read still on its way when the worker stops would answer the flow as well, saying it still runs
  await expect.poll(() => providersReadsPending).toBe(0)
  workerStopped = true
  await dialog.getByRole('option', { name: 'Household' }).click()
  const flow = page.getByRole('dialog', { name: 'Link bank account' })
  await flow.getByRole('radio', { name: /^3 months/ }).click()
  const submit = flow.getByRole('button', { name: 'Link and import' })
  await expect(submit).toHaveAttribute('aria-disabled', 'true')
  await expect(submit).toHaveAccessibleDescription(LINKING_PAUSED)

  // Waits out the moment a press that got through would have sent the link
  const linkSent = page
    .waitForRequest((sent) => sent.url() === `${API_BASE_URL}/accounts/${household.id}/bank-link` && sent.method() === 'POST', { timeout: 1_500 })
    .then(
      () => true,
      () => false,
    )
  await submit.click({ force: true })
  expect(await linkSent).toBe(false)
  await expect(flow).toBeVisible()
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
  // Below 1200px the sections are listed in the compact menu, named after the section on screen, so
  // every project runs this at a width that shows it
  await page.setViewportSize({ width: 1000, height: page.viewportSize()!.height })
  await logInViaApi(page, user)
  await openPage(page, '/settings')

  await expect(page.locator('#runway')).toBeVisible()
  await expect(page.locator('#bank-connections')).toHaveCount(0)

  await page.getByRole('button', { name: 'Profile', exact: true, expanded: false }).click()
  const sections = page.getByRole('navigation', { name: 'Settings sections' })
  await expect(sections.getByRole('button', { name: 'Runway' })).toBeVisible()
  await expect(sections.getByRole('button', { name: 'Bank connections' })).toHaveCount(0)
})
