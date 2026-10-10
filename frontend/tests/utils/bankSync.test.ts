/**
 * Tests the bank sync rules the settings section and the account's page share, so a rewrite catches a
 * group account, even the user's own, or another user's account read as one bank sync links, and a
 * disconnect that counts wrongly or reads "1 accounts"
 */
import { describe, expect, it } from 'vitest'
import type { BankConnection } from '@/api/bank-sync'
import { describeDisconnected, isOwnPersonalAccount } from '@/utils/bankSync'

function connection(overrides: Partial<BankConnection> = {}): BankConnection {
  return {
    id: 'connection-1',
    provider: 'simplefin',
    provider_name: 'SimpleFIN',
    nickname: null,
    server_label: 'bridge.simplefin.org',
    created_at: '2026-10-01T15:00:00Z',
    status: 'active',
    accounts: [],
    choose_again_links: [],
    discovery_pending: false,
    request_budget: { limit: 20, used: 0, available_again_at: null, held_by_provider: false },
    ...overrides,
  }
}

describe('isOwnPersonalAccount', () => {
  it('takes only an account the user owns outside any group', () => {
    expect(isOwnPersonalAccount({ owner_id: 'user-1', group_id: null }, 'user-1')).toBe(true)
    expect(isOwnPersonalAccount({ owner_id: 'user-1', group_id: 'group-1' }, 'user-1')).toBe(false)
    expect(isOwnPersonalAccount({ owner_id: 'user-2', group_id: null }, 'user-1')).toBe(false)
  })
})

describe('describeDisconnected', () => {
  it('counts the accounts a disconnect unlinked, and leaves the count out when there were none', () => {
    const joint = connection({ nickname: 'Joint banks' })

    expect(describeDisconnected(joint, 2)).toContain('Joint banks disconnected. 2 accounts unlinked.')
    expect(describeDisconnected(joint, 1)).toContain(' 1 account unlinked.')
    expect(describeDisconnected(joint, 0)).not.toContain('unlinked')
  })
})
