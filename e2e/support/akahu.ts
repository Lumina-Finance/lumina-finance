/**
 * The fake Akahu the instance syncs with: scenarios set up through its control API, and whether the
 * server offers Akahu at all, since deleting its provider folder removes it from the app
 */

import { expect, type APIRequestContext } from '@playwright/test'

import { asUser, type TestUser } from './api'
import { API_BASE_URL, FAKE_AKAHU_URL } from './target'

export interface FakeAkahuScenario {
  id: string

  /** The app ID token and user access token of a personal app reaching the scenario */
  appIdToken: string
  userAccessToken: string
}

/** Whether the server lists Akahu among the providers the user may connect */
export async function isAkahuOffered(request: APIRequestContext, user: TestUser): Promise<boolean> {
  const response = await request.get(`${API_BASE_URL}/bank-sync/providers`, { headers: asUser(user) })
  expect(response.status()).toBe(200)
  return ((await response.json()) as { providers: { id: string }[] }).providers.some((provider) => provider.id === 'akahu')
}

/**
 * Start a scenario holding the sample connection: Everyday Chequing and Rewards Visa at Harbour Bank,
 * both in New Zealand dollars, with a few weeks of transactions.
 *
 * @throws When no fake Akahu address was handed over, or the fake refuses the call
 */
export async function createSampleAkahuScenario(request: APIRequestContext): Promise<FakeAkahuScenario> {
  if (FAKE_AKAHU_URL === null) {
    throw new Error('E2E_FAKE_AKAHU_URL is required for the Akahu specs: where this machine reaches the fake Akahu the instance uses')
  }

  // On a connection of its own, since the fake closes one left idle for its keep-alive of 5 seconds,
  // and a request sent on one as it closes is hung up on rather than answered
  const response = await request.post(`${FAKE_AKAHU_URL}/control/scenarios/sample`, { headers: { connection: 'close' } })
  if (response.status() !== 201) {
    throw new Error(`the fake Akahu answered the sample scenario with ${response.status()}: ${await response.text()}`)
  }
  const { id, app_id_token: appIdToken, user_access_token: userAccessToken } = (await response.json()) as {
    id: string
    app_id_token: string
    user_access_token: string
  }
  return { id, appIdToken, userAccessToken }
}
