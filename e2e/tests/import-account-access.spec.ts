import { expect, test, type APIRequestContext } from '@playwright/test'

import { createAccount, signUpUser, type TestUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

const SHARED_ACCOUNT_NAME = 'Family Chequing'
const OWN_ACCOUNT_NAME = 'My Chequing'
const CSV = [
  'Date,Amount,Category,Merchant,Account',
  `2024-03-15,-12.34,Groceries,Unknown,${SHARED_ACCOUNT_NAME}`,
  `2024-03-16,-23.45,Groceries,Unknown,${OWN_ACCOUNT_NAME}`,
].join('\n')

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

// The same rule keeps the account off every choice that writes rows to it, so a file naming it
// can't be mapped there and fail at the very end
test('keeps an account the user can only read out of the accounts an import writes rows to', async ({ page, request }) => {
  const owner = await signUpUser(request)
  const member = await signUpUser(request)
  await shareReadOnlyAccount(request, owner, member)
  await createAccount(request, member, { name: OWN_ACCOUNT_NAME })

  await logInViaApi(page, member)
  await openPage(page, '/settings/imports')
  const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles({ name: 'accounts.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) })

  // The name match reaches only the account the user can write to, and the source naming the
  // shared account falls back to creating one of the user's own
  const ownRow = page.getByRole('combobox', { name: `Existing Account ${OWN_ACCOUNT_NAME}`, exact: true })
  const sharedRow = page.getByRole('combobox', { name: `Existing Account ${SHARED_ACCOUNT_NAME}`, exact: true })
  await expect(ownRow).toHaveText(OWN_ACCOUNT_NAME)
  await expect(sharedRow).toHaveText('Create New Account')

  await sharedRow.click()
  const listbox = page.getByRole('listbox')
  await expect(listbox.getByRole('option', { name: OWN_ACCOUNT_NAME })).toBeVisible()
  await expect(listbox.getByRole('option', { name: SHARED_ACCOUNT_NAME })).toHaveCount(0)
})
