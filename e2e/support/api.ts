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
