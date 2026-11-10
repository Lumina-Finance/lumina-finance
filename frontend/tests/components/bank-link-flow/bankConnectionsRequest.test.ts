/**
 * Covers the request a link to Settings, Bank connections carries in router state: what it reads back,
 * and that anything else in the state, from another kind of navigation, asks for nothing
 *
 * These tests catch a request read back as a different modal, a connection request with no id opening
 * something, and unrelated state taken for a request
 */
import { describe, expect, it, vi } from 'vitest'
import { openBankConnections, readBankConnectionsRequest } from '@/components/bank-link-flow/bankConnectionsRequest'
import { BANK_CONNECTIONS_SETTINGS_PATH } from '@/components/bank-link-flow/constants'

describe('the bank connections request', () => {
  it('goes to the one path, carrying the request in router state only when there is one', () => {
    const navigate = vi.fn()

    openBankConnections(navigate, { open: 'connect' })
    openBankConnections(navigate)

    expect(navigate).toHaveBeenNthCalledWith(1, BANK_CONNECTIONS_SETTINGS_PATH, {
      state: { bankConnectionsRequest: { open: 'connect' } },
    })
    expect(navigate).toHaveBeenNthCalledWith(2, BANK_CONNECTIONS_SETTINGS_PATH, undefined)
  })

  it('reads back what was sent', () => {
    const navigate = vi.fn()
    openBankConnections(navigate, { open: 'connection', connectionId: 'conn-1' })

    expect(readBankConnectionsRequest(navigate.mock.calls[0][1].state)).toEqual({
      open: 'connection',
      connectionId: 'conn-1',
    })
    expect(readBankConnectionsRequest({ bankConnectionsRequest: { open: 'connect' } })).toEqual({ open: 'connect' })
  })

  it('reads nothing from state that is not a request', () => {
    expect(readBankConnectionsRequest(null)).toBeNull()
    expect(readBankConnectionsRequest(undefined)).toBeNull()
    expect(readBankConnectionsRequest({ from: '/imports' })).toBeNull()
    expect(readBankConnectionsRequest({ bankConnectionsRequest: { open: 'connection' } })).toBeNull()
    expect(readBankConnectionsRequest({ bankConnectionsRequest: { open: 'elsewhere' } })).toBeNull()
    expect(readBankConnectionsRequest({ bankConnectionsRequest: 'connect' })).toBeNull()
  })
})
