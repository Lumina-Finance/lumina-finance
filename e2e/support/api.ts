/**
 * Creating a user's data over the API, so a spec starts from the state it wants to test
 * rather than clicking its way there through behaviour it is not testing.
 */

import type { APIRequestContext } from '@playwright/test'

// Satisfies the backend's password policy: twelve to a hundred and twenty-eight characters,
// with an uppercase letter, a digit and a special character
export const TEST_PASSWORD = 'E2ePassw0rd!'

// The browser runs in this zone too, set on the Playwright config, because the signup form
// takes its default from the browser and a spec asserting on a date would otherwise depend
// on where the machine running it happens to be
export const TEST_TIMEZONE = 'America/Toronto'

// Signup requires a base currency. Every seeded account uses it as well, since a transaction
// in a currency other than its account's needs an exchange rate supplied with it
export const TEST_CURRENCY = 'CAD'

// The container seeds this one alongside the system categories, so every spec has a merchant to
// name without creating one
const SYSTEM_MERCHANT = 'Unknown'

export interface TestUser {
  email: string
  password: string
  firstName: string

  /** Bearer token for calling the API as this user */
  accessToken: string
}

/**
 * Sign a new user up and return their credentials.
 *
 * Every call makes its own email address. That is what keeps one spec's data out of another's
 * and lets them all run at once against a single instance.
 *
 * @param request - Playwright request context, which carries the base URL
 * @returns The credentials of the user that was created
 * @throws When signup does not answer 201
 */
export async function signUpUser(request: APIRequestContext): Promise<TestUser> {
  const email = `e2e-${crypto.randomUUID()}@example.com`
  const firstName = 'Test'

  const response = await request.post('/api/auth/signup', {
    data: {
      email,
      password: TEST_PASSWORD,
      first_name: firstName,
      tz: TEST_TIMEZONE,
      base_currency: TEST_CURRENCY,
    },
  })

  if (response.status() !== 201) {
    throw new Error(`signup for ${email} answered ${response.status()}: ${await response.text()}`)
  }

  const body = (await response.json()) as { access_token: string }
  return { email, password: TEST_PASSWORD, firstName, accessToken: body.access_token }
}

/**
 * Build the authorization header for calls made as a signed-up user.
 */
function asUser(user: TestUser): Record<string, string> {
  return { Authorization: `Bearer ${user.accessToken}` }
}

/**
 * Today's date where the browser and the seeded data agree it is.
 *
 * A transaction's date is a plain calendar date the API stores as given, so seeding "now" from
 * the machine running the suite would put a transaction on tomorrow's date whenever that machine
 * is east of the zone the browser is pinned to.
 *
 * @returns The date as YYYY-MM-DD
 */
export function todayInTestTimezone(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TEST_TIMEZONE }).format(new Date())
}

/**
 * Look up a system record the container seeded, by its exact name.
 *
 * @param request - Playwright request context
 * @param user - User whose view of the records is read
 * @param kind - Which collection to search
 * @param name - Exact name as seeded
 * @returns The record's id
 * @throws When the collection cannot be read, or holds no record of that name
 */
export async function findReferenceId(
  request: APIRequestContext,
  user: TestUser,
  kind: 'categories' | 'merchants',
  name: string,
): Promise<string> {
  const response = await request.get(`/api/${kind}`, { headers: asUser(user) })
  if (!response.ok()) {
    throw new Error(`reading ${kind} answered ${response.status()}: ${await response.text()}`)
  }

  const records = (await response.json()) as { id: string; name: string }[]
  const match = records.find((record) => record.name === name)
  if (match === undefined) {
    throw new Error(`no ${kind} record named ${JSON.stringify(name)}`)
  }
  return match.id
}

export interface SeededAccount {
  id: string
  name: string
  currency: string
}

export interface CreateAccountOptions {
  name: string

  /** Must agree with the type, as the API checks the pair rather than deriving one from the other */
  accountKind?: string
  accountType?: string
  currency?: string

  /** Signed opening balance in minor units */
  startingBalance?: number
}

/**
 * Create an account over the API.
 *
 * @param request - Playwright request context
 * @param user - Account owner
 * @param options - What to create, defaulting to a chequing account in the test currency
 * @returns The account that was created
 * @throws When creation does not answer 201
 */
export async function createAccount(
  request: APIRequestContext,
  user: TestUser,
  options: CreateAccountOptions,
): Promise<SeededAccount> {
  const currency = options.currency ?? TEST_CURRENCY

  const response = await request.post('/api/accounts', {
    headers: asUser(user),
    data: {
      account_kind: options.accountKind ?? 'asset',
      account_type: options.accountType ?? 'checking',
      name: options.name,
      currency,
      starting_balance: options.startingBalance ?? null,
    },
  })

  if (response.status() !== 201) {
    throw new Error(`creating account ${options.name} answered ${response.status()}: ${await response.text()}`)
  }

  const body = (await response.json()) as { id: string }
  return { id: body.id, name: options.name, currency }
}

export interface CreateTransactionOptions {
  accountId: string

  /** Exact name of a seeded system category, such as Groceries */
  categoryName: string

  /** Signed minor units, so -4250 is $42.50 going out and 4250 is $42.50 coming in */
  amount: number

  /** Plain calendar date as YYYY-MM-DD, defaulting to today in the pinned zone */
  date?: string
  currency?: string
}

/**
 * Create a transaction over the API.
 *
 * The merchant is the seeded system record rather than one the spec makes, since every create
 * requires one and no spec asserts on it.
 *
 * @param request - Playwright request context
 * @param user - Transaction owner
 * @param options - What to record
 * @returns The transaction's id
 * @throws When creation does not answer 201
 */
export async function createTransaction(
  request: APIRequestContext,
  user: TestUser,
  options: CreateTransactionOptions,
): Promise<string> {
  const [categoryId, merchantId] = await Promise.all([
    findReferenceId(request, user, 'categories', options.categoryName),
    findReferenceId(request, user, 'merchants', SYSTEM_MERCHANT),
  ])

  const response = await request.post('/api/transactions', {
    headers: asUser(user),
    data: {
      account_id: options.accountId,
      dt: options.date ?? todayInTestTimezone(),
      category_id: categoryId,
      merchant_id: merchantId,
      amount: options.amount,
      currency: options.currency ?? TEST_CURRENCY,
    },
  })

  if (response.status() !== 201) {
    throw new Error(
      `recording ${options.amount} in ${options.categoryName} answered ${response.status()}: ${await response.text()}`,
    )
  }

  const body = (await response.json()) as { id: string }
  return body.id
}
