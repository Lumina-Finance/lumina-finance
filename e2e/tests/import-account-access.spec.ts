import { expect, test, type APIRequestContext } from '@playwright/test'

import { signUpUser, type TestUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

const SHARED_ACCOUNT_NAME = 'Family Chequing'

/**
 * Posts as a user and fails the test on any answer other than the one expected
 */
async function postAs(request: APIRequestContext, user: TestUser, path: string, data: object) {
  const response = await request.post(`${API_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${user.accessToken}` },
    data,
  })
  expect(response.status(), `${path} answered ${await response.text()}`).toBe(201)
  return await response.json() as { id: string }
}

/**
 * Shares a new group account with a second user at read level, which the app has no screen for
 */
async function shareReadOnlyAccount(request: APIRequestContext, owner: TestUser, member: TestUser) {
  const me = await request.get(`${API_BASE_URL}/me`, {
    headers: { Authorization: `Bearer ${member.accessToken}` },
  })
  expect(me.status()).toBe(200)
  const { id: memberId } = await me.json() as { id: string }

  const group = await postAs(request, owner, '/groups', { name: 'Household' })
  await postAs(request, owner, `/groups/${group.id}/members`, { user_id: memberId })
  const account = await postAs(request, owner, '/accounts', {
    account_kind: 'asset',
    account_type: 'checking',
    name: SHARED_ACCOUNT_NAME,
    currency: 'CAD',
    group_id: group.id,
  })
  await postAs(request, owner, `/accounts/${account.id}/permissions`, { user_id: memberId, level: 'read' })
  return account
}

// The commit writes rows only where the user can write, so an import into an account shared at
// read level is refused before a file is asked for rather than at the very end
test('refuses an import started from an account the user can only read', async ({ page, request }) => {
  const owner = await signUpUser(request)
  const member = await signUpUser(request)
  const shared = await shareReadOnlyAccount(request, owner, member)

  await logInViaApi(page, member)
  await openPage(page, `/settings/imports?account=${shared.id}`)
  await expect(page.getByRole('heading', { name: 'This action is not permitted', exact: true })).toBeVisible()

  // And the button that would start it there is shown disabled with the reason
  await openPage(page, `/accounts/${shared.id}`)
  const importButton = page.getByRole('button', { name: 'Import transactions into this account', exact: true })
  await expect(importButton).toBeDisabled()
  await expect(importButton).toHaveAttribute('title', 'Read-only access')
})
