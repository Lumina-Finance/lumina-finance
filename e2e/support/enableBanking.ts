/**
 * The fake Enable Banking the instance syncs with: scenarios set up through its control API, and whether
 * the server offers Enable Banking at all, since deleting its provider folder removes it from the app
 */

import { expect, type APIRequestContext } from '@playwright/test'

import { asUser, type TestUser } from './api'
import { API_BASE_URL, FAKE_ENABLE_BANKING_URL } from './target'

export interface FakeEnableBankingScenario {
  id: string

  /** The ID and private key of an application reaching the scenario */
  applicationId: string
  privateKey: string

  /** The one bank the application lists, and its country */
  bank: string
  country: string
}

/** Whether the server lists Enable Banking among the providers the user may connect */
export async function isEnableBankingOffered(request: APIRequestContext, user: TestUser): Promise<boolean> {
  const response = await request.get(`${API_BASE_URL}/bank-sync/providers`, { headers: asUser(user) })
  expect(response.status()).toBe(200)
  return ((await response.json()) as { providers: { id: string }[] }).providers.some(
    (provider) => provider.id === 'enable_banking',
  )
}

/**
 * Start a scenario sharing the sample accounts: Everyday and Visa Gold at Aurora Bank, both in euros,
 * with a few weeks of transactions.
 *
 * @throws When no fake Enable Banking address was handed over, or the fake refuses the call
 */
export async function createSampleEnableBankingScenario(request: APIRequestContext): Promise<FakeEnableBankingScenario> {
  if (FAKE_ENABLE_BANKING_URL === null) {
    throw new Error(
      'E2E_FAKE_ENABLE_BANKING_URL is required for the Enable Banking specs: where this machine reaches the fake Enable Banking the instance uses',
    )
  }

  // On a connection of its own, since the fake closes one left idle for its keep-alive of 5 seconds,
  // and a request sent on one as it closes is hung up on rather than answered
  const response = await request.post(`${FAKE_ENABLE_BANKING_URL}/control/scenarios/sample`, {
    headers: { connection: 'close' },
  })
  if (response.status() !== 201) {
    throw new Error(`the fake Enable Banking answered the sample scenario with ${response.status()}: ${await response.text()}`)
  }
  const body = (await response.json()) as {
    id: string
    application_id: string
    private_key: string
    bank: string
    country: string
  }
  return {
    id: body.id,
    applicationId: body.application_id,
    privateKey: body.private_key,
    bank: body.bank,
    country: body.country,
  }
}

/**
 * End every bank sign-in the scenario holds, as the end of the bank's consent does, so the next read
 * of its accounts is refused until the user signs in at the bank again
 *
 * @throws When the fake refuses the call
 */
export async function expireEnableBankingSessions(request: APIRequestContext, scenarioId: string): Promise<void> {
  const response = await request.post(`${FAKE_ENABLE_BANKING_URL}/control/scenarios/${scenarioId}/sessions/expire`, {
    headers: { connection: 'close' },
  })
  if (response.status() !== 204) {
    throw new Error(`the fake Enable Banking answered the session expiry with ${response.status()}: ${await response.text()}`)
  }
}
