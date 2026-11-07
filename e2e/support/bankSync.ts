/**
 * Bank connections for the bank specs: scenarios on the fake SimpleFIN Bridge the instance claims setup
 * tokens from, set up through its control API, and the app's own bank requests made as a user, so a
 * spec starts from the connections and failures it means to test. The instance links accounts and
 * its worker imports from the fake, so stand-ins answer the app's bank reads only where the fake can't
 * produce what a test needs, such as a removal, or can't produce it at the exact point the test needs
 */

import { expect, type APIRequestContext, type APIResponse, type Locator, type Page, type Request, type Route } from '@playwright/test'

import { asUser, findReferenceId, todayInTestTimezone, type TestUser } from './api'
import { openPage } from './app'
import { API_BASE_URL, FAKE_SIMPLEFIN_BRIDGE_URL } from './target'

/** Sep 21 of today's year, a bank date the app shows without a year */
export const SEP_21 = `${todayInTestTimezone().slice(0, 4)}-09-21`

/** Whether a request reads this API path, whatever its query */
export function isRead(path: string): (url: URL) => boolean {
  return (url: URL) => url.href.split('?')[0] === `${API_BASE_URL}${path}`
}

/** The bank providers read, as far as a spec changes it */
export type ProvidersAnswer = { may_link: boolean; sync_running: boolean; providers: Record<string, unknown>[] }

/**
 * Changes the server's answer to the bank providers read before the page sees it, such as whether the
 * deployment's worker is running, which a spec can't switch on the instance itself
 */
export async function changeProviders(page: Page, change: (body: ProvidersAnswer) => void | Promise<void>): Promise<void> {
  await page.route(`${API_BASE_URL}/bank-sync/providers`, async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    await change(body)
    await route.fulfill({ response, json: body })
  })
}

/** Where a bank-imported transaction came from, as the app reads it alongside the transaction */
export type BankSource = {
  provider: 'simplefin'
  provider_name: string
  bank_values: {
    date: string

    /** Signed minor units, money out negative */
    amount: number | null
    raw_amount: string | null
    description: string
  }
  received_at: string
  edited_fields: ('date' | 'amount')[]
  review_item_id: string | null
}

export type ReviewItemKind = 'new' | 'correction' | 'removal'

export type BankValues = BankSource['bank_values']

/** A bank item waiting for review, as the app reads it from the review list */
export type ReviewItem = {
  id: string
  kind: ReviewItemKind
  account_id: string
  bank: BankValues
  current: BankValues | null
  changed_fields: ('date' | 'amount' | 'description')[]
  [field: string]: unknown
}

/** One page of the review list */
export type ReviewPage = { items: ReviewItem[]; counts: Record<ReviewItemKind, number>; next_cursor: string | null }

/**
 * Builds an item of a kind on an account, $12.50 out on Sep 21 unless told otherwise. A correction
 * or removal is about a ledger transaction of $18.00 out
 */
export function reviewItem(
  id: string,
  kind: ReviewItemKind,
  accountId: string,
  bank: Partial<BankValues> = {},
  fields: Partial<ReviewItem> = {},
): ReviewItem {
  const values = { date: SEP_21, amount: -1250, raw_amount: null, description: `GROCER ${id}`, ...bank }
  return {
    id,
    kind,
    account_id: accountId,
    provider: 'simplefin',
    provider_name: 'SimpleFIN',
    received_at: `${SEP_21}T12:00:00Z`,
    version: 1,
    bank: values,
    transaction_id: kind === 'new' ? null : `transaction-${id}`,
    current: kind === 'new' ? null : { ...values, amount: -1800 },
    changed_fields: kind === 'correction' ? ['amount'] : [],
    protected_fields: [],
    ...fields,
  }
}

/**
 * A canned last page holding these items, with the counts given and none of any kind left out. How
 * the server counts what waits is left to the backend tests
 */
export function pageOf(items: ReviewItem[], counts: Partial<Record<ReviewItemKind, number>> = {}): ReviewPage {
  return { items, counts: { new: 0, correction: 0, removal: 0, ...counts }, next_cursor: null }
}

/**
 * Answers the review list with what `answer` returns for the accounts and cursor asked for, all
 * accounts being none, or fails it with the status returned. An answer still to settle holds the read
 * until it does. It stands in for what a sync from the fake can't bring in, such as a removal, a
 * backlog of hundreds or a page that fails
 */
export async function answerReviewItems(
  page: Page,
  answer: (accountIds: string[], cursor: string | null) => ReviewPage | number | Promise<ReviewPage | number>,
): Promise<void> {
  await page.route(isRead('/bank-review/items'), async (route) => {
    const url = new URL(route.request().url())
    const answered = await answer(url.searchParams.getAll('account_id'), url.searchParams.get('cursor'))
    return typeof answered === 'number'
      ? route.fulfill({ status: answered, json: { detail: 'Something went wrong' } })
      : route.fulfill({ json: answered })
  })
}

/** The block of bank items waiting for review above the transaction list */
export function reviewBlock(page: Page): Locator {
  return page.getByRole('region', { name: 'Waiting for review' })
}

/** A SimpleFIN transaction whose ledger values are still the bank's own */
export const BANK_SOURCE: BankSource = {
  provider: 'simplefin',
  provider_name: 'SimpleFIN',
  bank_values: {
    date: '2026-01-15',
    amount: -4250,
    raw_amount: null,
    description: 'GROCER 123',
  },
  received_at: '2026-01-15T14:30:00Z',
  edited_fields: [],
  review_item_id: null,
}

/**
 * Sends a request the page made on to the instance, changed as given, on a connection of its own. The
 * instance closes a connection left idle for its keep-alive, and a request sent on one as it closes
 * is hung up on, which the browser would send again on a new one but a route's fetch doesn't
 */
export async function fetchOnOwnConnection(
  route: Route,
  change: Pick<NonNullable<Parameters<Route['fetch']>[0]>, 'url' | 'postData'> = {},
): Promise<APIResponse> {
  return route.fetch({ ...change, headers: { ...(await route.request().allHeaders()), connection: 'close' } })
}

/**
 * Answers the app's reads of these transactions as imported from the bank, each with its source, for a
 * test that needs a source exactly as given without linking and syncing an account
 */
export async function answerAsBankImported(page: Page, sources: Record<string, BankSource>): Promise<void> {
  const isTransactionRead = (url: URL) => url.href.startsWith(`${API_BASE_URL}/transactions?`)
    || Object.keys(sources).some((id) => url.href === `${API_BASE_URL}/transactions/${id}`)
  await page.route(isTransactionRead, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()

    const response = await fetchOnOwnConnection(route)
    const body = await response.json() as { id: string } | { id: string }[]
    const markImported = (transaction: { id: string }) =>
      Object.hasOwn(sources, transaction.id) ? { ...transaction, bank_source: sources[transaction.id] } : transaction
    await route.fulfill({ response, json: Array.isArray(body) ? body.map(markImported) : markImported(body) })
  })
}

/** What a test moves on in a link's sync, as the app reads it alongside the account it links */
export type BankLinkSyncStatus = {
  last_success_at: string | null

  /** Whether a sync is under way, which the app polls for every couple of seconds */
  sync_in_progress: boolean

  /** New items waiting for their first review */
  waiting_new_count: number
}

/**
 * An account's live link as the server answers it, to Example Bank's chequing, which imports from
 * Jan 1, 2026 and has never synced, with nothing waiting, unless `status` says otherwise
 */
export function buildLinkAnswer(accountId: string, status: Partial<BankLinkSyncStatus> = {}) {
  const { last_success_at = null, sync_in_progress = false, waiting_new_count = 0 } = status
  return {
    account_id: accountId,
    connection_id: 'connection',
    provider: 'simplefin',
    provider_name: 'SimpleFIN',
    provider_site: 'SimpleFIN Bridge',
    provider_available: true,
    external_account_id: 'bank-account',
    external_account_name: 'Chequing',
    institution_name: 'Example Bank',
    import_start: '2026-01-01',
    linked_at: '2026-01-01T12:00:00Z',
    state: 'active',
    import: null,
    sync: {
      state: sync_in_progress ? 'syncing' : 'synced',
      last_success_at,
      last_failure: null,
      next_attempt_at: null,
      waiting_on_budget: false,
      held_by_provider: false,
      sync_running: false,
      sync_requested: false,
      waiting_new_count,
      paused: false,
      review_warning: false,
    },
  }
}

/**
 * Answers the app's read of the user's links in place of the server's, with a link for each account
 * `accountIds` returns, read again on every request so a test can unlink by emptying the list or move
 * a sync on through `status`, without waiting on the worker
 */
export async function answerLinksWith(
  page: Page,
  accountIds: () => string[],
  status: () => Partial<BankLinkSyncStatus> = () => ({}),
): Promise<void> {
  await page.route(`${API_BASE_URL}/bank-sync/links`, (route) => {
    const current = status()
    return route.fulfill({ json: accountIds().map((accountId) => buildLinkAnswer(accountId, current)) })
  })
}

// Long enough for the worker, which claims queued jobs every 5 seconds, to run one and save its result
export const WORKER_RESULT_TIMEOUT_MS = 60_000

// One frame on a page's clock, as the browser spaces animation frames
const CLOCK_FRAME_MS = 16

/**
 * Stops the page's clock where it has got to, which a test installs before opening the page, so its
 * timers and animation frames move only as `runClockUntil` moves them. A test that reads what it waits on
 * frame by frame, or keeps a message up for longer than a busy machine takes to reach it, then gets the
 * same frames and the same time however slowly the machine runs
 *
 * The clock can only be stopped at a time of day, which runs on while the call is on its way, and stopping
 * it short of that fails. So the time of day is held first and the clock stopped at it, and only then let
 * go. Stopping it at a later time instead would move the page's own clock past the browser's, and a fade
 * the browser runs from a start the page sets would wait that long to begin, holding a message out or a
 * closing dialog in
 */
export async function stopClock(page: Page): Promise<void> {
  const timeOfDay = Date.now()
  await page.clock.setFixedTime(timeOfDay)
  await page.clock.pauseAt(timeOfDay)
  await page.clock.setSystemTime(timeOfDay)
}

// How long a stopped clock moves on, at most, for a page to reach the state a test waits for. It is the
// page's own time, which a busy machine slows along with everything the page does
const CLOCK_RUN_LIMIT_MS = 10_000

/**
 * Moves a stopped clock on a frame at a time until the page has reached a state. The browser lays the
 * page out and draws it after each frame, as it does after a frame's callbacks, so what the page measures
 * as it draws, such as a size it watches, has come in before the next frame
 *
 * A state the page reaches on its own timers and frames is reached however slowly the machine runs. One
 * that also waits on something off the page's clock gets only the real time the steps take, and moves
 * the clock on meanwhile. A server's answer can outlast them, a few seconds where the steps are long, so
 * a test waits for it before moving the clock on. An animation the browser runs in real time, as a
 * modal's exit is, moves the clock on a step for each frame it lasts
 *
 * @param reached - Whether the page is in the state the test waits for yet
 * @param stepMs - How far the clock moves at a time. Longer than a frame, it takes fewer steps on a busy
 * machine to reach a state that waits on time passing rather than on any frame in particular, the
 * frames in between all running at once without the page drawn
 */
export async function runClockUntil(page: Page, reached: () => Promise<boolean>, stepMs = CLOCK_FRAME_MS): Promise<void> {
  for (let ran = 0; ran < CLOCK_RUN_LIMIT_MS; ran += stepMs) {
    await page.clock.runFor(stepMs)
    await page.evaluate(() => new Promise<void>((resolve) => {
      // A size watched from now on is first reported as the browser next lays the page out and draws it
      const watcher = new ResizeObserver(() => {
        watcher.disconnect()
        resolve()
      })
      watcher.observe(document.documentElement)
    }))
    if (await reached()) return
  }
  expect(await reached(), `reached within ${CLOCK_RUN_LIMIT_MS} ms on the page's clock`).toBe(true)
}

/**
 * Waits for the dialog to finish scaling in. Motion scales it frame by frame from script, which leaves the
 * browser no animation to wait on, and a distance or place read before it ends comes out off by the scale
 */
export async function waitForEntrance(dialog: Locator): Promise<void> {
  await expect.poll(() => dialog.evaluate((element) => {
    for (let node: Element | null = element; node; node = node.parentElement) {
      if (getComputedStyle(node).transform !== 'none') return false
    }
    return true
  })).toBe(true)
}

/**
 * The identity card's Bank sync fact reading as given
 *
 * @param status - The label the fact shows. A pattern ends with the period that ends the label's
 * sentence in the fact's name, since a label ending in p.m. has one already
 */
export function bankSyncFact(page: Page, status: string | RegExp): Locator {
  const name = typeof status === 'string' ? `Bank sync: ${status}. Open bank link` : new RegExp(`^Bank sync: ${status.source} Open bank link$`)
  return page.getByRole('button', { name })
}

/**
 * Opens the account's page and, once the identity card's Bank sync fact reads as given, its edit
 * modal at the Bank link section through that fact. Returns once the modal's scroll to the section has
 * ended, which it asks for a moment after opening and eases into where its content runs past what it
 * shows by then. A press on a control before then has the browser bring the control into view on the
 * way, which stops the modal short of the section
 *
 * @param status - The label the fact should come to show, which may take the worker a while, as
 * `bankSyncFact` reads it
 */
export async function openBankLink(page: Page, accountId: string, status: string | RegExp): Promise<Locator> {
  await openPage(page, `/accounts/${accountId}`)
  const bankSync = bankSyncFact(page, status)
  await expect(bankSync).toBeVisible({ timeout: WORKER_RESULT_TIMEOUT_MS })

  // Listening from before the modal opens, so a scroll that ends however soon is heard. A scroll asked
  // for where the modal's content already sits, as where it fits when the moment comes, goes nowhere and
  // ends as it is asked for, even if the section grows past the bottom afterwards
  await page.evaluate(() => {
    const scrolled = () => {
      (window as Window & { modalScrolled?: boolean }).modalScrolled = true
    }
    document.addEventListener('scrollend', (event) => {
      if (event.target instanceof Element && event.target.closest('[role="dialog"]')) scrolled()
    }, { capture: true })
    const scrollTo = Element.prototype.scrollTo
    Element.prototype.scrollTo = function (this: Element, ...asked: unknown[]) {
      const top = typeof asked[0] === 'number' ? asked[1] as number : (asked[0] as ScrollToOptions | undefined)?.top
      const reachable = Math.max(0, Math.min(top ?? this.scrollTop, this.scrollHeight - this.clientHeight))
      if (this.closest('[role="dialog"]') && Math.abs(reachable - this.scrollTop) < 1) scrolled()
      Reflect.apply(scrollTo, this, asked)
    }
  })
  await bankSync.click()
  const dialog = page.getByRole('dialog', { name: 'Edit account', exact: true })
  await expect(dialog).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as Window & { modalScrolled?: boolean }).modalScrolled === true)).toBe(true)
  return dialog
}

/** Whatever the Bank sync fact reads once the page has read the link, rather than Checking… */
export const READ_LINK_STATUS = /(?!Checking…).+\./

/**
 * Opens the account's page and, once the identity card's Bank sync fact reads as given, its edit modal
 * through that fact, holding the read of the bank link the modal makes as it opens until `released`
 * settles. The page has read the link by the time the fact reads as given, so the modal opens on what
 * that read found, and the held read brings in whatever the server holds by the time it is let through
 *
 * @param status - The label the fact should come to show, as `bankSyncFact` reads it
 * @param timeout - How long the fact may take to come to show it, where the worker has yet to finish
 */
export async function openBankLinkHoldingRead(
  page: Page,
  accountId: string,
  status: string | RegExp,
  released: Promise<unknown>,
  timeout?: number,
): Promise<Locator> {
  const linkUrl = `${API_BASE_URL}/accounts/${accountId}/bank-link`
  let holding = false
  const letThrough = new Set<Request>()
  const landed = (sent: Request) => letThrough.delete(sent)
  page.on('requestfinished', landed)
  page.on('requestfailed', landed)
  await page.route(linkUrl, async (route) => {
    if (holding) await released
    else letThrough.add(route.request())
    await route.fallback()
  })
  await openPage(page, `/accounts/${accountId}`)
  const bankSync = bankSyncFact(page, status)
  await expect(bankSync).toBeVisible({ timeout })
  holding = true
  const reread = page.waitForRequest((sent) => sent.url() === linkUrl && sent.method() === 'GET')

  // The page reads the link again whenever its poll of the link list finds it changed. A read let
  // through before the hold would bring in what the server held then, and the modal's own read would
  // join it rather than go out held, so the modal opens once every such read has landed
  await expect.poll(() => letThrough.size).toBe(0)
  page.off('requestfinished', landed)
  page.off('requestfailed', landed)
  await bankSync.click()
  await reread
  return page.getByRole('dialog', { name: 'Edit account', exact: true })
}

/** A toast saying why something failed, which is announced as an alert */
export function errorToast(page: Page, text: string): Locator {
  return page.getByRole('alert').filter({ hasText: text })
}

export interface BridgeScenario {
  id: string

  /** A setup token that has not been claimed yet */
  setupToken: string
}

export interface SeededConnection {
  id: string
  accounts: { external_id: string; name: string; institution_name: string; linked_account_id: string | null; signin_needed: boolean }[]
  status: 'active' | 'credential_rejected'

  /** The requests sent to the provider in the last 24 hours, of the most the connection may send */
  request_budget: { limit: number; used: number; available_again_at: string | null; held_by_provider: boolean }
}

/**
 * Call the fake Bridge's control API.
 *
 * @throws When no Bridge address was handed over, or the Bridge refuses the call
 */
async function controlBridge<T>(request: APIRequestContext, method: 'post' | 'patch' | 'put' | 'delete', path: string, data?: object): Promise<T> {
  if (FAKE_SIMPLEFIN_BRIDGE_URL === null) {
    throw new Error('E2E_FAKE_SIMPLEFIN_BRIDGE_URL is required for the bank specs: where this machine reaches the fake SimpleFIN Bridge the instance uses')
  }

  // Each on a connection of its own. The fake closes a connection left idle for its keep-alive of 5
  // seconds, and a request sent on one as it closes is hung up on rather than answered
  const response = await request[method](`${FAKE_SIMPLEFIN_BRIDGE_URL}/control/scenarios${path}`, { data, headers: { connection: 'close' } })
  if (!response.ok()) {
    throw new Error(`the fake SimpleFIN Bridge answered ${method.toUpperCase()} ${path} with ${response.status()}: ${await response.text()}`)
  }
  return (response.status() === 204 ? undefined : await response.json()) as T
}

/**
 * Start a scenario holding the sample bank login: Everyday Chequing and Rewards Visa at Harbour Bank,
 * both in Canadian dollars.
 */
export async function createSampleBridgeScenario(request: APIRequestContext): Promise<BridgeScenario> {
  const { id, setup_token: setupToken } = await controlBridge<{ id: string; setup_token: string }>(request, 'post', '/sample')
  return { id, setupToken }
}

/**
 * Start a scenario with no bank logins, for a spec that adds its own.
 */
export async function createEmptyBridgeScenario(request: APIRequestContext): Promise<BridgeScenario> {
  const { id, setup_token: setupToken } = await controlBridge<{ id: string; setup_token: string }>(request, 'post', '')
  return { id, setupToken }
}

/**
 * Add a bank login, whose name the app shows as the institution of every bank account under it.
 *
 * @returns The login's id
 */
export async function addBridgeBankLogin(request: APIRequestContext, scenarioId: string, name: string): Promise<string> {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const { conn_id: connId } = await controlBridge<{ conn_id: string }>(request, 'post', `/${scenarioId}/connections`, { name, org_id: `ORG-${slug}` })
  return connId
}

/**
 * Add a bank account under a bank login.
 *
 * @param currency - An ISO code, or a URL for a currency of the provider's own
 * @returns The bank account's id
 */
export async function addBridgeBankAccount(
  request: APIRequestContext,
  scenarioId: string,
  options: { connId: string; name: string; currency: string },
): Promise<string> {
  const { id } = await controlBridge<{ id: string }>(request, 'post', `/${scenarioId}/accounts`, {
    conn_id: options.connId,
    name: options.name,
    currency: options.currency,
    balance: '100.00',
  })
  return id
}

/**
 * Give a bank account a new id, as SimpleFIN does when it lists the same account differently.
 */
export async function changeBridgeBankAccountId(request: APIRequestContext, scenarioId: string, accountId: string, newId: string): Promise<void> {
  await controlBridge(request, 'patch', `/${scenarioId}/accounts/${accountId}`, { id: newId })
}

/**
 * Change the balances the Bridge sends for a bank account, each kept exactly as given.
 */
export async function changeBridgeBalances(
  request: APIRequestContext,
  scenarioId: string,
  accountId: string,
  balances: { balance?: string; available_balance?: string },
): Promise<void> {
  await controlBridge(request, 'patch', `/${scenarioId}/accounts/${accountId}`, balances)
}

/**
 * Return another setup token reaching the same scenario, as a reconnect needs.
 */
export async function createBridgeSetupToken(request: APIRequestContext, scenarioId: string): Promise<string> {
  const { setup_token: setupToken } = await controlBridge<{ setup_token: string }>(request, 'post', `/${scenarioId}/setup-tokens`)
  return setupToken
}

/**
 * Report a problem with a bank login in every response from now on, as SimpleFIN does when the bank
 * needs the user to sign in again.
 */
export async function requireBridgeBankSignIn(request: APIRequestContext, scenarioId: string, connId: string): Promise<void> {
  await controlBridge(request, 'post', `/${scenarioId}/errors`, { code: 'con.auth', msg: 'Sign in to your bank again', conn_id: connId })
}

/**
 * Revoke the access claimed so far, as disabling the token in SimpleFIN Bridge does.
 */
export async function revokeBridgeAccess(request: APIRequestContext, scenarioId: string): Promise<void> {
  await controlBridge(request, 'post', `/${scenarioId}/revoke`)
}

/**
 * Answer every request, the claim included, with an error page from in front of the Bridge.
 */
export async function breakBridge(request: APIRequestContext, scenarioId: string): Promise<void> {
  await controlBridge(request, 'put', `/${scenarioId}/fault`, { kind: 'html_error' })
}

/**
 * Hold every request, the claim included, unanswered until its client gives up or the fault is
 * cleared, so a sync stays running for as long as a test needs it to
 */
export async function stallBridge(request: APIRequestContext, scenarioId: string): Promise<void> {
  await controlBridge(request, 'put', `/${scenarioId}/fault`, { kind: 'timeout' })
}

/**
 * Answer requests normally again, freeing any a stall still holds, so the worker it held moves on to
 * other tests' syncs rather than waiting out its read timeout
 */
export async function clearBridgeFault(request: APIRequestContext, scenarioId: string): Promise<void> {
  await controlBridge(request, 'delete', `/${scenarioId}/fault`)
}

/**
 * Claim a setup token as a user, adding a connection.
 *
 * @returns The connection, with the bank accounts the claim listed
 * @throws When the claim does not answer 201
 */
export async function claimSetupToken(
  request: APIRequestContext,
  user: TestUser,
  setupToken: string,
  nickname?: string,
): Promise<SeededConnection> {
  const response = await request.post(`${API_BASE_URL}/bank-sync/connections`, {
    headers: asUser(user),
    data: { provider: 'simplefin', credentials: { setup_token: setupToken }, nickname },
  })
  if (response.status() !== 201) {
    throw new Error(`claiming a setup token answered ${response.status()}: ${await response.text()}`)
  }
  return (await response.json()) as SeededConnection
}

/**
 * Link an account to a bank account on a connection, starting the import on the given day.
 *
 * @throws When the link does not answer 201
 */
export async function linkBankAccount(
  request: APIRequestContext,
  user: TestUser,
  options: { accountId: string; connectionId: string; externalAccountId: string; startDate: string },
): Promise<void> {
  const response = await request.post(`${API_BASE_URL}/accounts/${options.accountId}/bank-link`, {
    headers: asUser(user),
    data: { connection_id: options.connectionId, external_account_id: options.externalAccountId, start_date: options.startDate },
  })
  if (response.status() !== 201) {
    throw new Error(`linking account ${options.accountId} answered ${response.status()}: ${await response.text()}`)
  }
}

/**
 * Link an account to one of the sample bank login's bank accounts on a connection of its own,
 * importing from the given day, today unless told otherwise.
 *
 * @param bankAccountName - Everyday Chequing or Rewards Visa
 * @param balances - Balances the Bridge sends for the bank account in place of the sample's, set
 * before the link so its first import reads them, each kept exactly as given
 * @returns The scenario the connection reaches, and the connection
 */
export async function linkToSampleBankAccount(
  request: APIRequestContext,
  user: TestUser,
  options: {
    accountId: string
    bankAccountName: string
    startDate?: string
    balances?: { balance?: string; available_balance?: string }
  },
): Promise<{ scenario: BridgeScenario; connection: SeededConnection }> {
  const scenario = await createSampleBridgeScenario(request)
  const connection = await claimSetupToken(request, user, scenario.setupToken)
  const externalAccountId = connection.accounts.find((bankAccount) => bankAccount.name === options.bankAccountName)!.external_id
  if (options.balances) await changeBridgeBalances(request, scenario.id, externalAccountId, options.balances)
  await linkBankAccount(request, user, {
    accountId: options.accountId,
    connectionId: connection.id,
    externalAccountId,
    startDate: options.startDate ?? todayInTestTimezone(),
  })
  return { scenario, connection }
}

/**
 * A transaction for the Bridge to send: booked on a day, as YYYY-MM-DD, or pending with no day, under
 * an id of its own unless one is given, as a spec that later changes it needs
 */
export type BridgeTransaction = { id?: string; amount: string; description: string } & ({ posted: string } | { pending: true })

/**
 * Add transactions to a bank account in one call, as for 1,000 or more in a range.
 */
export async function addBridgeTransactions(
  request: APIRequestContext,
  scenarioId: string,
  accountId: string,
  transactions: BridgeTransaction[],
): Promise<void> {
  await controlBridge(request, 'post', `/${scenarioId}/accounts/${accountId}/transactions`, { transactions })
}

/**
 * Change a transaction the Bridge sends, as a bank correcting its amount does
 */
export async function changeBridgeTransaction(
  request: APIRequestContext,
  scenarioId: string,
  accountId: string,
  transactionId: string,
  change: { amount?: string; description?: string; posted?: string },
): Promise<void> {
  await controlBridge(request, 'patch', `/${scenarioId}/accounts/${accountId}/transactions/${transactionId}`, change)
}

/**
 * Link an account to Everyday Chequing at Harbour Bank, a bank account with a balance of 100.00 that
 * holds no transactions but any given, on a connection of its own, importing from the given day
 *
 * @returns The scenario the connection reaches, and the bank account's id at the Bridge
 */
export async function linkToEmptyBankAccount(
  request: APIRequestContext,
  user: TestUser,
  options: { accountId: string; startDate: string; transactions?: BridgeTransaction[] },
): Promise<{ scenario: BridgeScenario; externalAccountId: string }> {
  const scenario = await createEmptyBridgeScenario(request)
  const connId = await addBridgeBankLogin(request, scenario.id, 'Harbour Bank')
  const externalAccountId = await addBridgeBankAccount(request, scenario.id, { connId, name: 'Everyday Chequing', currency: 'CAD' })
  if (options.transactions) await addBridgeTransactions(request, scenario.id, externalAccountId, options.transactions)
  const connection = await claimSetupToken(request, user, scenario.setupToken)
  await linkBankAccount(request, user, { accountId: options.accountId, connectionId: connection.id, externalAccountId, startDate: options.startDate })
  return { scenario, externalAccountId }
}

/**
 * Read the items waiting for review in a linked account, as the review list's first page holds them,
 * newest first
 */
export async function readReviewItems(request: APIRequestContext, user: TestUser, accountId: string): Promise<ReviewItem[]> {
  const response = await request.get(`${API_BASE_URL}/bank-review/items?account_id=${accountId}`, { headers: asUser(user) })
  expect(response.status()).toBe(200)
  return ((await response.json()) as ReviewPage).items
}

/**
 * Wait for the worker to bring the items waiting in a linked account to what a spec needs, such as the
 * new items an import brought in or a correction a sync found
 *
 * @param reached - Whether the items waiting, newest first, are what the spec needs yet
 * @returns The items waiting once they are
 */
export async function waitForReviewItems(
  request: APIRequestContext,
  user: TestUser,
  accountId: string,
  reached: (items: ReviewItem[]) => boolean,
): Promise<ReviewItem[]> {
  let items: ReviewItem[] = []
  await expect.poll(async () => {
    items = await readReviewItems(request, user, accountId)
    return reached(items)
  }, { timeout: WORKER_RESULT_TIMEOUT_MS }).toBe(true)
  return items
}

/** A link's sync as the list of links reads it, as far as a spec waits on it */
type LinkSync = { state: string; sync_running: boolean; sync_requested: boolean }

/**
 * Sync a linked account now, as Sync now does, once its import and any sync already under way are
 * over, so the worker reads what the Bridge sends from then on
 *
 * @throws When the server refuses the sync
 */
export async function syncBankLinkNow(request: APIRequestContext, user: TestUser, accountId: string): Promise<void> {
  await expect.poll(async () => {
    const response = await request.get(`${API_BASE_URL}/bank-sync/links`, { headers: asUser(user) })
    expect(response.status()).toBe(200)
    const link = ((await response.json()) as { account_id: string; sync: LinkSync }[]).find((entry) => entry.account_id === accountId)
    return link !== undefined && link.sync.state !== 'importing' && !link.sync.sync_running && !link.sync.sync_requested
  }, { timeout: WORKER_RESULT_TIMEOUT_MS }).toBe(true)

  const response = await request.post(`${API_BASE_URL}/accounts/${accountId}/bank-link/sync`, { headers: asUser(user) })
  if (response.status() !== 200) {
    throw new Error(`syncing account ${accountId} answered ${response.status()}: ${await response.text()}`)
  }
}

/** Reads when the account last synced, as the server has it */
export async function readLastSuccess(request: APIRequestContext, user: TestUser, accountId: string): Promise<string | null> {
  const response = await request.get(`${API_BASE_URL}/accounts/${accountId}/bank-link`, { headers: asUser(user) })
  expect(response.status()).toBe(200)
  return ((await response.json()) as { link: { sync: { last_success_at: string | null } } }).link.sync.last_success_at
}

/** A ledger transaction as the server holds it, as far as a bank spec reads it back */
export type SavedTransaction = {
  id: string
  account_id: string
  dt: string
  amount: number
  category_id: string
  merchant_id: string | null
  counterparty_account_id: string | null
  counterparty_account_scope: string | null
  bank_source: BankSource | null
}

/**
 * Read a ledger transaction as the server holds it, to check what a review or a restore saved
 */
export async function readTransaction(request: APIRequestContext, user: TestUser, id: string): Promise<SavedTransaction> {
  const response = await request.get(`${API_BASE_URL}/transactions/${id}`, { headers: asUser(user) })
  expect(response.status()).toBe(200)
  return (await response.json()) as SavedTransaction
}

/**
 * Edit a ledger transaction's date or amount as the user does, which a bank-imported one then counts as
 * edited
 *
 * @throws When the edit is refused
 */
export async function editTransaction(
  request: APIRequestContext,
  user: TestUser,
  id: string,
  change: { dt?: string; amount?: number },
): Promise<void> {
  const response = await request.patch(`${API_BASE_URL}/transactions/${id}`, { headers: asUser(user), data: change })
  if (!response.ok()) {
    throw new Error(`editing transaction ${id} answered ${response.status()}: ${await response.text()}`)
  }
}

/**
 * Wait for the worker to import a linked account's bank item, then add it to the ledger in Groceries
 * with the bank's date and amount, as reviewing it does.
 *
 * @param description - The bank's description of the item
 * @param amount - The amount to add it with in minor units, in place of one the account's currency
 * can't hold
 * @returns The bank-imported transaction's id and date
 * @throws When adding it does not answer 201
 */
export async function addImportedItem(
  request: APIRequestContext,
  user: TestUser,
  accountId: string,
  description: string,
  amount?: number,
): Promise<{ id: string; date: string }> {
  const isItem = (entry: ReviewItem) => entry.bank.description === description
  const { id, bank } = (await waitForReviewItems(request, user, accountId, (items) => items.some(isItem))).find(isItem)!
  const [categoryId, merchantId] = await Promise.all([
    findReferenceId(request, user, 'categories', 'Groceries'),
    findReferenceId(request, user, 'merchants', 'Unknown'),
  ])
  const response = await request.post(`${API_BASE_URL}/bank-review/items/${id}/add`, {
    headers: asUser(user),
    data: { dt: bank.date, amount: amount ?? bank.amount, category_id: categoryId, merchant_id: merchantId },
  })
  if (response.status() !== 201) {
    throw new Error(`adding the bank item ${description} answered ${response.status()}: ${await response.text()}`)
  }
  return { id: ((await response.json()) as { id: string }).id, date: bank.date }
}

/**
 * Read one of the user's connections as the app does.
 */
export async function readConnection(request: APIRequestContext, user: TestUser, connectionId: string): Promise<SeededConnection | undefined> {
  const response = await request.get(`${API_BASE_URL}/bank-sync/connections`, { headers: asUser(user) })
  expect(response.status()).toBe(200)
  return ((await response.json()) as SeededConnection[]).find((connection) => connection.id === connectionId)
}

/**
 * Wait for the worker to bring a connection to the state a spec needs, such as rejected after an
 * import met revoked access.
 *
 * @param reached - Whether the connection as read is in that state yet
 */
export async function waitForConnection(
  request: APIRequestContext,
  user: TestUser,
  connectionId: string,
  reached: (connection: SeededConnection) => boolean,
): Promise<void> {
  await expect.poll(async () => {
    const connection = await readConnection(request, user, connectionId)
    return connection !== undefined && reached(connection)
  }, { timeout: WORKER_RESULT_TIMEOUT_MS }).toBe(true)
}
