import type { NavigateFunction } from 'react-router'
import { BANK_CONNECTIONS_SETTINGS_PATH } from '@/components/bank-link-flow/constants'

/**
 * What a link to Settings, Bank connections wants opened over the page once it has scrolled there:
 * the modal to add a connection, or the modal of one connection, where it is reconnected
 */
export type BankConnectionsRequest = { open: 'connect' } | { open: 'connection'; connectionId: string }

const STATE_KEY = 'bankConnectionsRequest'

/** Goes to Bank connections in Settings, asking for a modal there when a request is given */
export function openBankConnections(navigate: NavigateFunction, request?: BankConnectionsRequest) {
  navigate(BANK_CONNECTIONS_SETTINGS_PATH, request ? { state: { [STATE_KEY]: request } } : undefined)
}

/** The request a navigation carried in its router state, or null when it carried none or one it can't read */
export function readBankConnectionsRequest(state: unknown): BankConnectionsRequest | null {
  if (typeof state !== 'object' || state === null || !(STATE_KEY in state)) return null
  const request = (state as Record<string, unknown>)[STATE_KEY]
  if (typeof request !== 'object' || request === null) return null
  const { open, connectionId } = request as Record<string, unknown>
  if (open === 'connect') return { open }
  if (open === 'connection' && typeof connectionId === 'string') return { open, connectionId }
  return null
}
