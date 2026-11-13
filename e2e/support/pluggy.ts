/**
 * The fake Pluggy the instance syncs with: scenarios set up through its control API, and whether the
 * server offers Pluggy at all, since deleting its provider folder removes it from the app
 */

import { expect, type APIRequestContext } from '@playwright/test'

import { asUser, type TestUser } from './api'
import { API_BASE_URL, FAKE_PLUGGY_URL } from './target'

export interface FakePluggyScenario {
  id: string

  /** The client ID and client secret of an application reaching the scenario */
  clientId: string
  clientSecret: string

  /** The item the scenario's accounts sit under */
  itemId: string
}

/** Whether the server lists Pluggy among the providers the user may connect */
export async function isPluggyOffered(request: APIRequestContext, user: TestUser): Promise<boolean> {
  const response = await request.get(`${API_BASE_URL}/bank-sync/providers`, { headers: asUser(user) })
  expect(response.status()).toBe(200)
  return ((await response.json()) as { providers: { id: string }[] }).providers.some((provider) => provider.id === 'pluggy')
}

/**
 * Start a scenario holding the sample item: Conta Corrente and Cartão Pluggy Gold at Pluggy Bank,
 * both in Brazilian reais, with a few weeks of transactions.
 *
 * @throws When no fake Pluggy address was handed over, or the fake refuses the call
 */
export async function createSamplePluggyScenario(request: APIRequestContext): Promise<FakePluggyScenario> {
  if (FAKE_PLUGGY_URL === null) {
    throw new Error('E2E_FAKE_PLUGGY_URL is required for the Pluggy specs: where this machine reaches the fake Pluggy the instance uses')
  }

  // On a connection of its own, since the fake closes one left idle for its keep-alive of 5 seconds,
  // and a request sent on one as it closes is hung up on rather than answered
  const response = await request.post(`${FAKE_PLUGGY_URL}/control/scenarios/sample`, { headers: { connection: 'close' } })
  if (response.status() !== 201) {
    throw new Error(`the fake Pluggy answered the sample scenario with ${response.status()}: ${await response.text()}`)
  }
  const { id, client_id: clientId, client_secret: clientSecret, item_ids: itemIds } = (await response.json()) as {
    id: string
    client_id: string
    client_secret: string
    item_ids: string[]
  }
  return { id, clientId, clientSecret, itemId: itemIds[0] }
}
