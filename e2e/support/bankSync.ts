/**
 * Bank connections for the bank specs: scenarios on the fake SimpleFIN Bridge the instance claims setup
 * tokens from, set up through its control API, and the app's own bank requests made as a user, so a
 * spec starts from the connections and failures it means to test. Stand-ins answer the app's bank
 * reads that the instance can't yet produce, such as a transaction imported from a bank.
 */

import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import { asUser, findReferenceId, todayInTestTimezone, type TestUser } from './api'
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
    merchant_name: string | null
    category_hint: string | null
  }
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
  const values = { date: SEP_21, amount: -1250, raw_amount: null, description: `GROCER ${id}`, merchant_name: null, category_hint: null, ...bank }
  return {
    id,
    kind,
    account_id: accountId,
    provider: 'simplefin',
    provider_name: 'SimpleFIN',
    external_transaction_id: `TRN-${id}`,
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

/** One page holding every one of these items, counted by kind */
export function pageOf(items: ReviewItem[]): ReviewPage {
  const count = (kind: ReviewItemKind) => items.filter((item) => item.kind === kind).length
  return { items, counts: { new: count('new'), correction: count('correction'), removal: count('removal') }, next_cursor: null }
}

/**
 * Answers the review list with what `answer` returns for the accounts and cursor asked for, all
 * accounts being none, or fails it with the status returned. An answer still to settle holds the read
 * until it does. Nothing links an account on the server for a sync to bring items in
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
    merchant_name: null,
    category_hint: null,
  },
  edited_fields: [],
  review_item_id: null,
}

/**
 * Answers the app's reads of these transactions as imported from the bank, each with its source,
 * since nothing links an account on the server for a sync to import one
 */
export async function answerAsBankImported(page: Page, sources: Record<string, BankSource>): Promise<void> {
  const isTransactionRead = (url: URL) => url.href.startsWith(`${API_BASE_URL}/transactions?`)
    || Object.keys(sources).some((id) => url.href === `${API_BASE_URL}/transactions/${id}`)
  await page.route(isTransactionRead, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()

    // Retried, since the instance now and then drops a reused connection, which the browser would retry
    const response = await route.fetch({ maxRetries: 2 })
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

export interface BridgeScenario {
  id: string

  /** A setup token that has not been claimed yet */
  setupToken: string
}

export interface SeededConnection {
  id: string
  accounts: { external_id: string; name: string; institution_name: string; linked_account_id: string | null; signin_needed: boolean }[]
  status: 'active' | 'credential_rejected'
}

/**
 * Call the fake Bridge's control API.
 *
 * @throws When no Bridge address was handed over, or the Bridge refuses the call
 */
async function controlBridge<T>(request: APIRequestContext, method: 'post' | 'patch' | 'put', path: string, data?: object): Promise<T> {
  if (FAKE_SIMPLEFIN_BRIDGE_URL === null) {
    throw new Error('E2E_FAKE_SIMPLEFIN_BRIDGE_URL is required for the bank specs: where this machine reaches the fake SimpleFIN Bridge the instance uses')
  }

  const response = await request[method](`${FAKE_SIMPLEFIN_BRIDGE_URL}/control/scenarios${path}`, { data })
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
    data: { provider: 'simplefin', setup_token: setupToken, nickname },
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
 * @returns The scenario the connection reaches, and the connection
 */
export async function linkToSampleBankAccount(
  request: APIRequestContext,
  user: TestUser,
  options: { accountId: string; bankAccountName: string; startDate?: string },
): Promise<{ scenario: BridgeScenario; connection: SeededConnection }> {
  const scenario = await createSampleBridgeScenario(request)
  const connection = await claimSetupToken(request, user, scenario.setupToken)
  await linkBankAccount(request, user, {
    accountId: options.accountId,
    connectionId: connection.id,
    externalAccountId: connection.accounts.find((bankAccount) => bankAccount.name === options.bankAccountName)!.external_id,
    startDate: options.startDate ?? todayInTestTimezone(),
  })
  return { scenario, connection }
}

/**
 * Wait for the worker to import a linked account's bank item, then add it to the ledger in Groceries
 * with the bank's date and amount, as reviewing it does.
 *
 * @param description - The bank's description of the item
 * @returns The bank-imported transaction's id and date
 * @throws When adding it does not answer 201
 */
export async function addImportedItem(
  request: APIRequestContext,
  user: TestUser,
  accountId: string,
  description: string,
): Promise<{ id: string; date: string }> {
  let item: ReviewItem | undefined
  await expect.poll(async () => {
    const response = await request.get(`${API_BASE_URL}/bank-review/items?account_id=${accountId}`, { headers: asUser(user) })
    item = ((await response.json()) as ReviewPage).items.find((entry) => entry.bank.description === description)
    return item !== undefined
  }, { timeout: WORKER_RESULT_TIMEOUT_MS }).toBe(true)

  const { id, bank } = item!
  const [categoryId, merchantId] = await Promise.all([
    findReferenceId(request, user, 'categories', 'Groceries'),
    findReferenceId(request, user, 'merchants', 'Unknown'),
  ])
  const response = await request.post(`${API_BASE_URL}/bank-review/items/${id}/add`, {
    headers: asUser(user),
    data: { dt: bank.date, amount: bank.amount, category_id: categoryId, merchant_id: merchantId },
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
