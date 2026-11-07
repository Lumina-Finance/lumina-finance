/**
 * The fake Lunch Flow the instance syncs with: scenarios set up through its control API, and whether
 * the server offers Lunch Flow at all, since deleting its provider folder removes it from the app
 */

import { expect, type APIRequestContext } from '@playwright/test'

import { asUser, type TestUser } from './api'
import { API_BASE_URL, FAKE_LUNCHFLOW_URL } from './target'

export interface FakeLunchFlowScenario {
  id: string

  /** An API key reaching the scenario */
  apiKey: string
}

/** Whether the server lists Lunch Flow among the providers the user may connect */
export async function isLunchFlowOffered(request: APIRequestContext, user: TestUser): Promise<boolean> {
  const response = await request.get(`${API_BASE_URL}/bank-sync/providers`, { headers: asUser(user) })
  expect(response.status()).toBe(200)
  return ((await response.json()) as { providers: { id: string }[] }).providers.some((provider) => provider.id === 'lunchflow')
}

/**
 * Start a scenario holding the sample connection: Everyday Chequing and Rewards Visa at Harbour Bank,
 * both in Canadian dollars, with a few weeks of transactions.
 *
 * @throws When no fake Lunch Flow address was handed over, or the fake refuses the call
 */
export async function createSampleLunchFlowScenario(request: APIRequestContext): Promise<FakeLunchFlowScenario> {
  if (FAKE_LUNCHFLOW_URL === null) {
    throw new Error('E2E_FAKE_LUNCHFLOW_URL is required for the Lunch Flow specs: where this machine reaches the fake Lunch Flow the instance uses')
  }

  // On a connection of its own, since the fake closes one left idle for its keep-alive of 5 seconds,
  // and a request sent on one as it closes is hung up on rather than answered
  const response = await request.post(`${FAKE_LUNCHFLOW_URL}/control/scenarios/sample`, { headers: { connection: 'close' } })
  if (response.status() !== 201) {
    throw new Error(`the fake Lunch Flow answered the sample scenario with ${response.status()}: ${await response.text()}`)
  }
  const { id, api_key: apiKey } = (await response.json()) as { id: string; api_key: string }
  return { id, apiKey }
}
