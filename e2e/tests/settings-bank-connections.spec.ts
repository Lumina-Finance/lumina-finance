import { expect, test, type APIRequestContext, type Locator, type Page, type Route } from '@playwright/test'

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
import { AT_EVERY_SIZE } from '../support/sizes'
import { API_BASE_URL, BASE_URL } from '../support/target'

// Runs on desktop only, apart from the linked account tile test, which runs on the phone, and the linking
// and reconnect tests, which run at every size: the institutions sit below the connection and its actions
// on a phone, the connection fills a phone's screen with its message still in the corner, and a folded
// institution's count moves under its name on a phone. The rest set the window sizes they check
// themselves or give the same result at every size

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
const PROVIDER_GONE =
  "This provider is no longer available on this server, so this connection doesn't sync. You can disconnect it to remove it, and its accounts keep everything already imported."

// Where a connection is claimed, and the list read
const CONNECTIONS_URL = `${API_BASE_URL}/bank-sync/connections`

// What a proxy answers in place of a request the server behind it took too long to answer
const GATEWAY_TIMEOUT_PAGE = '<html><body><h1>504 Gateway Time-out</h1></body></html>'

// Longer than a claim can take, so a dialogue waiting on one whose answer was lost has given up by then
const PAST_THE_LONGEST_CLAIM_MS = 3 * 60 * 1000

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

/** What a theme token draws as on one CSS property, so a tone is compared by name rather than by value */
async function tokenColour(page: Page, property: 'color' | 'background-color' | 'border-top-color', token: string): Promise<string> {
  return page.evaluate(([cssProperty, name]) => {
    const probe = document.createElement('span')
    probe.style.setProperty(cssProperty, `var(${name})`)
    document.body.append(probe)
    const drawn = getComputedStyle(probe).getPropertyValue(cssProperty)
    probe.remove()
    return drawn
  }, [property, token] as const)
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

/** Whether a request goes to one connection's own address, where a rename is sent */
function isRename(url: URL): boolean {
  return /\/bank-sync\/connections\/[^/]+$/.test(url.pathname)
}

/**
 * Holds each rename the page sends until the returned function is called, then fails it as though the
 * server was never reached
 */
async function holdRenamesUntilFailed(page: Page): Promise<() => void> {
  let fail = () => {}
  const failed = new Promise<void>((resolve) => { fail = resolve })
  await page.route(isRename, async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback()
    await failed
    await route.abort('failed')
  })
  return fail
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

test("draws the setup token field's hint like the nickname's and says why Connect is held back", async ({ page, request }) => {
  const user = await signUpUser(request)
  const scenario = await createSampleBridgeScenario(request)
  const section = await openBankConnections(page, user)

  await section.getByRole('button', { name: 'Add a connection' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add a connection' })
  const token = dialog.getByRole('textbox', { name: 'Setup token' })
  const hint = (field: Locator) => field.evaluate((element) => {
    const style = getComputedStyle(element, '::placeholder')
    return `${style.fontFamily} ${style.fontSize}`
  })
  expect(await hint(token)).toBe(await hint(dialog.getByRole('textbox', { name: 'Nickname' })))

  const connect = dialog.getByRole('button', { name: 'Connect' })
  await expect(connect).toBeDisabled()
  await expect(connect).toHaveAccessibleDescription('Paste the setup token first')
  await token.fill(scenario.setupToken)
  await expect(connect).toBeEnabled()
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

test('draws each field a provider lists, checks each against its own limit and sends them under their keys', async ({ page, request }) => {
  const user = await signUpUser(request)
  await changeProviders(page, (body) => {
    body.providers[0].credential_fields = [
      { key: 'app_token', label: 'App ID token', placeholder: 'Paste the app token', max_length: 8 },
      { key: 'user_token', label: 'User access token', placeholder: 'Paste the user token', max_length: 64 },
    ]
  })
  const sent: unknown[] = []
  const refusal = 'That user access token has expired. Create a new one and try again'
  await page.route(CONNECTIONS_URL, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    sent.push(route.request().postDataJSON())
    await route.fulfill({ status: 422, json: { detail: refusal } })
  })
  const section = await openBankConnections(page, user)

  await section.getByRole('button', { name: 'Add a connection' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add a connection' })
  const appToken = dialog.getByRole('textbox', { name: 'App ID token' })
  const userToken = dialog.getByRole('textbox', { name: 'User access token' })
  await expect(dialog.getByRole('textbox', { name: 'Setup token' })).toHaveCount(0)
  await appToken.fill('app-token-too-long')
  await expect(dialog.getByRole('button', { name: 'Connect' })).toBeDisabled()
  await userToken.fill('user-1')
  await dialog.getByRole('button', { name: 'Connect' }).click()

  await expect(dialog.getByRole('alert')).toHaveText('That app ID token is too long. Copy only the app ID token from SimpleFIN Bridge and try again')
  await expect(appToken).toHaveAttribute('aria-invalid', 'true')
  expect(sent).toEqual([])

  await appToken.fill('app-1')
  await dialog.getByRole('button', { name: 'Connect' }).click()
  await expect(dialog.getByRole('alert')).toHaveText(refusal)
  // The refusal is about the credentials as a whole, so every field is marked and points to the one message
  for (const field of [appToken, userToken]) {
    await expect(field).toHaveAttribute('aria-invalid', 'true')
    await expect(field).toHaveAccessibleDescription(refusal)
  }
  await appToken.fill('app-2')
  await expect(appToken).not.toHaveAttribute('aria-invalid')
  await expect(userToken).not.toHaveAttribute('aria-invalid')
  expect(sent).toEqual([expect.objectContaining({ provider: 'simplefin', credentials: { app_token: 'app-1', user_token: 'user-1' } })])
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

test('says to check the connections once a claim whose answer was lost must have finished with none shown', async ({ page, request }) => {
  const user = await signUpUser(request)
  const scenario = await createSampleBridgeScenario(request)

  // The claim never reaches the server, as when a phone loses its connection as it sends, so no
  // connection shows however long the dialogue waits
  let loseClaim: () => void = () => {}
  const claimLost = new Promise<void>((resolve) => { loseClaim = resolve })
  await page.route(CONNECTIONS_URL, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    await route.abort()
    loseClaim()
  })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.install()
  const section = await openBankConnections(page, user)

  await section.getByRole('button', { name: 'Add a connection' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add a connection' })
  await dialog.getByRole('textbox', { name: 'Setup token' }).fill(scenario.setupToken)
  await dialog.getByRole('button', { name: 'Connect' }).click()
  await claimLost

  await page.clock.runFor(PAST_THE_LONGEST_CLAIM_MS)
  await expect(dialog.getByRole('alert')).toContainText('The connection may have been added')
  await expect(dialog.getByRole('button', { name: 'Connect' })).not.toHaveAttribute('aria-busy', 'true')
})

test('waits on after a gateway timeout, and closes as connected once the server saves the connection', async ({ page, request }) => {
  const user = await signUpUser(request)
  const scenario = await createSampleBridgeScenario(request)
  const section = await openBankConnections(page, user)
  const failedClaims: string[] = []
  page.on('requestfailed', (failed) => {
    if (failed.method() === 'POST' && failed.url() === CONNECTIONS_URL) failedClaims.push(failed.failure()?.errorText ?? '')
  })

  // A proxy answers 504 at once, and the claim reaches the server only after the list has been read
  // again, as when the server finishes a claim the proxy in front of it stopped waiting for. A proxy on
  // the app's own origin sends no cross-origin headers, but this instance serves the API from another
  // origin, so the page needs the ones the server would send to read the 504 at all
  let holdClaim: (route: Route) => void = () => {}
  const claimed = new Promise<Route>((resolve) => { holdClaim = resolve })
  await page.route(CONNECTIONS_URL, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    holdClaim(route)
    await route.fulfill({
      status: 504,
      headers: { 'access-control-allow-origin': new URL(BASE_URL).origin, 'access-control-allow-credentials': 'true' },
      contentType: 'text/html',
      body: GATEWAY_TIMEOUT_PAGE,
    })
  })
  const claimAnswered = page.waitForResponse((response) => response.request().method() === 'POST' && response.url() === CONNECTIONS_URL)

  await section.getByRole('button', { name: 'Add a connection' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add a connection' })
  await dialog.getByRole('textbox', { name: 'Setup token' }).fill(scenario.setupToken)
  const connect = dialog.getByRole('button', { name: 'Connect' })
  await connect.click()

  // A read of the list after the 504 comes only once the claim has failed, so by then the dialogue
  // would show any message it had for it
  await claimAnswered
  await page.waitForResponse((response) =>
    response.request().method() === 'GET' && isRead('/bank-sync/connections')(new URL(response.url())))
  await expect(connect).toHaveAttribute('aria-busy', 'true')
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeEnabled()

  // The server saves the connection before it lists its bank accounts, so a read partway finds it
  // with none and none due, which isn't yet the connection to report. A second such read comes a poll
  // later, by when a dialogue the first had closed would be long gone
  let listed = false
  let partwayReads = 0
  let readPartwayTwice: () => void = () => {}
  const partwayTwice = new Promise<void>((resolve) => { readPartwayTwice = resolve })
  await page.route(CONNECTIONS_URL, async (route) => {
    if (route.request().method() !== 'GET' || listed) return route.fallback()
    const response = await route.fetch()
    const connections: object[] = await response.json()
    await route.fulfill({ response, json: connections.map((connection) => ({ ...connection, accounts: [], discovery_pending: false })) })
    if (connections.length > 0 && ++partwayReads === 2) readPartwayTwice()
  })
  await (await claimed).fetch()
  await partwayTwice
  await expect(dialog).toBeVisible()
  await expect(connect).toHaveAttribute('aria-busy', 'true')

  listed = true
  await expect(dialog).toBeHidden()
  await expect(toast(page, 'SimpleFIN connected with 2 bank accounts.')).toBeVisible()
  await expect(connectionRow(section, 'SimpleFIN')).toContainText('0 of 2')
  expect(failedClaims).toEqual([])
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

// Rename is pressed the moment a saved rename gives it back, which brings back the field that saved while
// it is still fading out, rather than a new one
test('renames a connection again straight after a rename, from the field still fading out', async ({ page, request }) => {
  const user = await signUpUser(request)
  const scenario = await createSampleBridgeScenario(request)
  await claimSetupToken(request, user, scenario.setupToken)
  const section = await openBankConnections(page, user)
  const dialog = await openConnection(page, section, 'SimpleFIN')

  const renameButton = dialog.getByRole('button', { name: 'Rename' })
  await renameButton.click()
  await dialog.getByRole('textbox', { name: 'Connection nickname' }).fill('Joint banks')
  await renameButton.evaluate((button: HTMLButtonElement) => {
    new MutationObserver((_, observer) => {
      if (button.disabled) return
      observer.disconnect()
      button.click()
    }).observe(button, { attributes: true, attributeFilter: ['disabled'] })
  })
  await page.keyboard.press('Enter')

  const field = page.getByRole('dialog', { name: 'Joint banks', exact: true }).getByRole('textbox', { name: 'Connection nickname' })
  await expect(field).toBeEditable()
  await field.fill('Travel cards')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Travel cards', exact: true }).getByRole('heading', { name: 'Travel cards' })).toBeVisible()
})

// A rename on its way holds the modal open, as a disconnect does, so word that it failed comes beside the
// connection it was for. The rename is held here until the modal has been asked to close, then fails
test('keeps the modal open while a rename is on its way, saying there if it fails', async ({ page, request }) => {
  const user = await signUpUser(request)
  const scenario = await createSampleBridgeScenario(request)
  await claimSetupToken(request, user, scenario.setupToken)
  const failRename = await holdRenamesUntilFailed(page)
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

// Escape pressed straight after Enter reaches the field before it has rendered as saving, which a later
// press no longer does, since the field is held back by then. Both keys go to the field in one task, so
// it can't render in between, and the rename is held until both are in, then fails
test('keeps the nickname typed when Escape follows Enter straight away, so a failed rename can be tried again', async ({ page, request }) => {
  const user = await signUpUser(request)
  const scenario = await createSampleBridgeScenario(request)
  await claimSetupToken(request, user, scenario.setupToken)
  const failRename = await holdRenamesUntilFailed(page)
  const section = await openBankConnections(page, user)
  const dialog = await openConnection(page, section, 'SimpleFIN')

  await dialog.getByRole('button', { name: 'Rename' }).click()
  const field = dialog.getByRole('textbox', { name: 'Connection nickname' })
  await field.fill('Joint banks')
  await field.evaluate((input) => {
    for (const key of ['Enter', 'Escape']) input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })

  failRename()
  await expect(errorToast(page, 'Could not rename this connection. Please try again.')).toBeVisible()
  await expect(field).toHaveValue('Joint banks')
  await expect(field).toBeEnabled()
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

test("draws a connection's status as a round dot, never a dash", AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  const scenario = await createSampleBridgeScenario(request)
  await claimSetupToken(request, user, scenario.setupToken)
  const section = await openBankConnections(page, user)

  const [listDot] = await readBoxes(page, [connectionRow(section, 'SimpleFIN').getByTestId('sync-status-dot').filter({ visible: true })])
  expect(listDot.width).toBeGreaterThanOrEqual(8)
  expect(listDot.height).toBeCloseTo(listDot.width, 0)

  const dialog = await openConnection(page, section, 'SimpleFIN')
  const [factDot] = await readBoxes(page, [fact(dialog, 'Status').getByTestId('sync-status-dot')])
  expect(factDot.height).toBeCloseTo(factDot.width, 0)
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

test("says a connection's provider is gone from the server, holding Reconnect back with the reason", AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  const [household, scenario] = await Promise.all([
    createAccount(request, user, { name: 'Household' }),
    createSampleBridgeScenario(request),
  ])
  const connection = await claimSetupToken(request, user, scenario.setupToken)
  await linkBankAccount(request, user, {
    accountId: household.id,
    connectionId: connection.id,
    externalAccountId: connection.accounts.find((bankAccount) => bankAccount.name === SAMPLE_CHEQUING)!.external_id,
    startDate: todayInTestTimezone(),
  })
  // Stands for a server whose provider folder was deleted, which the backend tests answer this way
  await page.route(isRead('/bank-sync/connections'), async (route) => {
    const response = await route.fetch()
    const connections = (await response.json() as SeededConnection[]).map((entry) => ({
      ...entry,
      provider_site: null,
      provider_available: false,
      request_budget: { ...entry.request_budget, limit: null, used: 0, available_again_at: null },
    }))
    await route.fulfill({ response, json: connections })
  })
  const section = await openBankConnections(page, user)
  await expect(connectionRow(section, 'SimpleFIN')).toContainText('Provider unavailable')
  const dialog = await openConnection(page, section, 'SimpleFIN')
  await expect(dialog).toHaveCSS('transform', 'none')

  await expect(dialog.getByText('SimpleFIN is no longer available', { exact: true })).toBeInViewport()
  // The held-back Reconnect gives the same reason, as its description
  await expect(dialog.getByRole('paragraph').filter({ hasText: PROVIDER_GONE })).toBeInViewport()
  await expect(fact(dialog, 'Status')).toHaveText('Provider unavailable')
  await expect(fact(dialog, 'Requests, 24 hours')).toHaveText('None sent')
  // The folded row writes its note once for a phone and once beside the count, showing one at each size
  await expect(dialog.getByRole('button', { name: '1 institution' })).toContainText('1 of 2 linked · Nothing links or syncs here now')

  const reconnect = dialog.getByRole('button', { name: 'Reconnect' })
  await expect(reconnect).toBeInViewport()
  await expect(reconnect).toHaveAttribute('aria-disabled', 'true')
  await expect(reconnect).toHaveAccessibleDescription(PROVIDER_GONE)
  // Forced, since Playwright waits for a control marked unavailable to become available before pressing it
  await reconnect.click({ force: true })
  await expect(page.getByRole('dialog', { name: /^Reconnect/ })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Disconnect' })).toBeEnabled()
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)

  // The actions clip what doesn't fit their buttons, so a whole label showing is its words ending inside every box around them
  for (const action of ['Rename', 'Disconnect']) {
    const edges = await dialog.getByRole('button', { name: action }).evaluate((button, word) => {
      const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT)
      const words = document.createRange()
      while (walker.nextNode()) {
        if (walker.currentNode.textContent?.includes(word)) words.selectNodeContents(walker.currentNode)
      }
      const drawn = words.getBoundingClientRect()
      const gaps: number[] = []
      for (let box = words.startContainer.parentElement; box && box !== button.parentElement; box = box.parentElement) {
        const edge = box.getBoundingClientRect()
        gaps.push(drawn.left - edge.left, edge.right - drawn.right)
      }
      return Math.min(...gaps)
    }, action)
    expect(edges, `${action} label inside its button`).toBeGreaterThanOrEqual(-0.5)
  }

  // A state that needs the user's attention but breaks nothing takes the watch colour, never the error red
  const tile = dialog.getByTestId('connection-state-tile')
  expect(await tile.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(await tokenColour(page, 'background-color', '--app-warning-soft'))
  expect(await tile.evaluate((element) => getComputedStyle(element).color)).toBe(await tokenColour(page, 'color', '--app-warning-text'))
  const dotBorder = (dot: Locator) => dot.evaluate((element) => getComputedStyle(element).borderTopColor)
  const warningDot = await tokenColour(page, 'border-top-color', '--app-warning-dot')
  expect(await dotBorder(fact(dialog, 'Status').getByTestId('sync-status-dot'))).toBe(warningDot)
  await dialog.getByRole('button', { name: 'Close' }).first().click()
  await expect(dialog).toBeHidden()
  expect(await dotBorder(connectionRow(section, 'SimpleFIN').getByTestId('sync-status-dot').filter({ visible: true }))).toBe(warningDot)
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

test('links a bank account from the connection, importing from the start chosen', AT_EVERY_SIZE, async ({ page, request }) => {
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

test('finds a connection by its linked account or nickname, and disconnects it after asking again, then focuses the next connection', async ({ page, request }) => {
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

  const search = section.getByRole('textbox', { name: 'Find a connection or institution…' })
  for (const [query, shown, hidden] of [['household', 'Joint banks', 'Travel cards'], ['travel', 'Travel cards', 'Joint banks']]) {
    await search.fill(query)
    await expect(connectionRow(section, shown)).toBeVisible()
    await expect(connectionRow(section, hidden)).toHaveCount(0)
  }
  await search.fill('nothing like this')
  await expect(section.getByText('No connections match your search.')).toBeVisible()
  await search.fill('')
  await expect(connectionRow(section, 'Travel cards')).toBeVisible()
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
  await expect(section.getByPlaceholder('Find a connection or institution…')).toBeFocused()
})

test('reconnects a rejected connection, and shows the account to choose again under Mismatch detected', AT_EVERY_SIZE, async ({ page, request }) => {
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

test('says to try again when Reconnect loses its answer, and shows the connection working once the server has it', async ({ page, request }) => {
  const user = await signUpUser(request)
  const scenario = await createSampleBridgeScenario(request)
  const connection = await claimSetupToken(request, user, scenario.setupToken)

  // The connection works on the server throughout, as a reconnect that landed leaves it, and only the
  // reads before Reconnect is sent say it was rejected. The server refuses to reconnect a working
  // connection, so the reconnect is dropped on the way rather than sent, and the browser sees its
  // answer lost
  let reconnectSent = false
  await changeAnswer<{ status: string }[]>(page, '/bank-sync/connections', (connections) => {
    if (!reconnectSent) connections[0].status = 'credential_rejected'
  })
  await page.route(`${CONNECTIONS_URL}/${connection.id}/reconnect`, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    reconnectSent = true
    await route.abort()
  })
  const section = await openBankConnections(page, user)
  const row = connectionRow(section, 'SimpleFIN')
  await expect(row).toContainText('Reconnect needed')

  const dialog = await openConnection(page, section, 'SimpleFIN')
  await dialog.getByRole('button', { name: 'Reconnect', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'Reconnect SimpleFIN' })
  await form.getByRole('textbox', { name: 'Setup token' }).fill(await createBridgeSetupToken(request, scenario.id))
  await form.getByRole('button', { name: 'Reconnect', exact: true }).click()

  await expect(form.getByRole('alert')).toHaveText('Something went wrong. Please try again.')
  await form.getByRole('button', { name: 'Cancel' }).click()
  await expect(form).toBeHidden()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(row).toContainText('OK')
  await expect(row).not.toContainText('Reconnect needed')
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

test("keeps a connection's facts column from scrolling sideways, so the status note's icon stays under the pointer", async ({ page, request }) => {
  const user = await signUpUser(request)

  // Only the status's note, opening from after the longest status, reaches past the column's edge while closed
  await claimConnectionNeedingSignIn(request, user)
  const section = await openBankConnections(page, user)
  const dialog = await openConnection(page, section, 'SimpleFIN')
  await expect(dialog).toHaveCSS('transform', 'none')
  const column = dialog.getByRole('complementary')
  const icon = dialog.getByRole('button', { name: 'Status details' })
  const atRest = (await icon.boundingBox())!
  const drawnAtRest = await page.screenshot({ clip: atRest })

  // A trackpad swipe across the column, further than the closed note reaches past its edge. The browser
  // answers once it has drawn the swipe, which the page itself learns of only at a later frame, so what
  // is drawn where the icon sat is compared rather than where the page places the icon
  const columnBox = (await column.boundingBox())!
  const browser = await page.context().newCDPSession(page)
  await browser.send('Input.synthesizeScrollGesture', {
    x: columnBox.x + columnBox.width / 2,
    y: columnBox.y + columnBox.height / 2,
    xDistance: -SIDEWAYS_SWIPE_PX,
    yDistance: 0,
    gestureSourceType: 'mouse',
  })
  expect(await page.screenshot({ clip: atRest })).toEqual(drawnAtRest)
})

test("opens a fact's note below its value where the dialog leaves no room above the fact", async ({ page, request }) => {
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

// The linked account's tile draws its edge with its fill, Disconnect with its border and the institution's
// count with its text, each on the edge of its own box, so comparing the boxes compares what is drawn
test("ends a linked account's tile and its institution's count on the edge the connection's actions end on, on a phone", AT_EVERY_SIZE, async ({ page, request }) => {
  test.skip(test.info().project.name !== 'phone', 'The institutions sit below the connection and its actions under 1050px, which only the phone project is')
  const user = await signUpUser(request)
  const [household, scenario] = await Promise.all([
    createAccount(request, user, { name: 'Household' }),
    createSampleBridgeScenario(request),
  ])
  const connection = await claimSetupToken(request, user, scenario.setupToken)
  await linkBankAccount(request, user, {
    accountId: household.id,
    connectionId: connection.id,
    externalAccountId: connection.accounts.find((bankAccount) => bankAccount.name === SAMPLE_CHEQUING)!.external_id,
    startDate: todayInTestTimezone(),
  })
  const section = await openBankConnections(page, user)
  const dialog = await openConnection(page, section, 'SimpleFIN')
  await expect(dialog).toHaveCSS('transform', 'none')

  const [tile, count, disconnect] = await readBoxes(page, [
    dialog.getByRole('link', { name: 'Household' }),
    dialog.getByText('1 of 2 linked', { exact: true }),
    dialog.getByRole('button', { name: 'Disconnect' }),
  ])
  expect(tile.x + tile.width).toBeCloseTo(disconnect.x + disconnect.width, 0)
  expect(count.x + count.width).toBeCloseTo(disconnect.x + disconnect.width, 0)
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

  // A press that got through would send the link before the page takes the next press, so the links
  // sent are counted once Cancel has closed the flow
  let linksSent = 0
  page.on('request', (sent) => {
    if (sent.url() === `${API_BASE_URL}/accounts/${household.id}/bank-link` && sent.method() === 'POST') linksSent += 1
  })
  await submit.click({ force: true })
  await expect(flow).toBeVisible()
  await flow.getByRole('button', { name: 'Cancel' }).click()
  await expect(flow).toBeHidden()
  expect(linksSent).toBe(0)
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
  // this runs at a width that shows it
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
