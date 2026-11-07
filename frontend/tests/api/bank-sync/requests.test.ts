/**
 * Covers the bank sync request functions that reshape what they send
 *
 * These tests catch the review list losing its place between pages, a body losing the field names
 * the backend reads, such as the credential a reconnect sends, a request that waits on the bank
 * provider failing at the shared request limit while the server is still finishing it, and a read
 * that keeps going after the load that asked for it was abandoned
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  authenticatedFetch: authenticatedFetchMock,
}))

import {
  claimCredential,
  createBankLink,
  fetchAccountBankStatus,
  fetchBankConnections,
  fetchBankLinks,
  fetchBankProviders,
  fetchBulkApprovalPreview,
  fetchDiscoveredBankAccounts,
  fetchImportRange,
  fetchPendingBankTransactions,
  fetchReviewBacklogs,
  fetchReviewPage,
  fetchReviewPreferences,
  reconnectBankConnection,
} from '@/api/bank-sync/requests'
import { REQUEST_TIMEOUT_MS } from '@/api/server'

beforeEach(() => {
  authenticatedFetchMock.mockReset()
  authenticatedFetchMock.mockResolvedValue({})
})

describe('bank sync reads', () => {
  it('reads the review page of two accounts from the cursor the last page gave, in pages of fifty', async () => {
    await fetchReviewPage({ accountIds: ['account-1', 'account-2'], cursor: 'cursor-2' })

    expect(authenticatedFetchMock).toHaveBeenCalledWith(
      '/bank-review/items?account_id=account-1&account_id=account-2&cursor=cursor-2&limit=50',
      expect.anything(),
    )
  })

  it.each([
    ['the providers', (signal: AbortSignal) => fetchBankProviders(signal)],
    ['the connections', (signal: AbortSignal) => fetchBankConnections(signal)],
    [
      'a connection’s bank accounts',
      (signal: AbortSignal) => fetchDiscoveredBankAccounts('connection-1', 'account-1', signal),
    ],
    ['the links', (signal: AbortSignal) => fetchBankLinks(signal)],
    ['an account’s link', (signal: AbortSignal) => fetchAccountBankStatus('account-1', signal)],
    ['the import range', (signal: AbortSignal) => fetchImportRange('account-1', 'simplefin', signal)],
    ['the review settings', (signal: AbortSignal) => fetchReviewPreferences('account-1', signal)],
    ['a review page', (signal: AbortSignal) => fetchReviewPage({ cursor: null }, signal)],
    ['the review backlogs', (signal: AbortSignal) => fetchReviewBacklogs(undefined, signal)],
    ['the pending transactions', (signal: AbortSignal) => fetchPendingBankTransactions(undefined, signal)],
    ['the bulk approval preview', (signal: AbortSignal) => fetchBulkApprovalPreview(undefined, signal)],
  ])('passes the abort signal on to the request reading %s', async (_label, read) => {
    const { signal } = new AbortController()

    await read(signal)

    expect(authenticatedFetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ signal }))
  })
})

describe('bank sync writes', () => {
  it('links through the account path and leaves the account out of the body', async () => {
    await createBankLink({
      account_id: 'account-1',
      connection_id: 'connection-1',
      external_account_id: 'bank-account-1',
      start_date: '2026-01-01',
    })

    expect(authenticatedFetchMock).toHaveBeenCalledWith('/accounts/account-1/bank-link', {
      method: 'POST',
      body: JSON.stringify({
        connection_id: 'connection-1',
        external_account_id: 'bank-account-1',
        start_date: '2026-01-01',
      }),
    })
  })

  it('sends the new credential under the name the backend reads when reconnecting', async () => {
    await reconnectBankConnection({ connectionId: 'connection-1', credentials: { setup_token: 'token' } })

    expect(authenticatedFetchMock).toHaveBeenCalledWith(
      '/bank-sync/connections/connection-1/reconnect',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ credentials: { setup_token: 'token' } }),
      }),
    )
  })

  it('previews bulk approval for every account with a null account list', async () => {
    await fetchBulkApprovalPreview()
    await fetchBulkApprovalPreview(['account-1'])

    expect(authenticatedFetchMock.mock.calls.map(([, options]) => options.body)).toEqual([
      JSON.stringify({ account_ids: null }),
      JSON.stringify({ account_ids: ['account-1'] }),
    ])
  })
})

describe('giving a request that waits on the bank provider time to finish', () => {
  // The server answers each of these only once the provider has taken the credential and listed the
  // bank accounts, which can outlast an ordinary request. By then the credential may be spent, so one
  // cut off at the shared limit shows an error the user can't fix by trying the same one again
  it.each([
    ['claiming a credential', () => claimCredential({ provider: 'simplefin', credentials: { setup_token: 'token' } })],
    [
      'reconnecting',
      () => reconnectBankConnection({ connectionId: 'connection-1', credentials: { setup_token: 'token' } }),
    ],
  ])('waits longer than the shared request limit when %s', async (_label, send) => {
    await send()

    const [, options] = authenticatedFetchMock.mock.calls[0]
    expect(options.timeoutMs).toBeGreaterThan(REQUEST_TIMEOUT_MS)
  })
})
