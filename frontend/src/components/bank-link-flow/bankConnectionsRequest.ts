import type { NavigateFunction } from 'react-router'
import { BANK_CONNECTIONS_SETTINGS_PATH } from '@/components/bank-link-flow/constants'

/**
 * What a link to Settings, Bank connections wants opened over the page once it has scrolled there:
 * the modal to add a connection, or the modal of one connection, where it is reconnected. A link from
 * an account's bank link flow names the account, so a connection made there returns to its flow
 */
export type BankConnectionsRequest = ({ open: 'connect' } | { open: 'connection'; connectionId: string }) & {
  returnToAccountId?: string
}

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
  const { open, connectionId, returnToAccountId } = request as Record<string, unknown>
  const returnTo = typeof returnToAccountId === 'string' ? { returnToAccountId } : {}
  if (open === 'connect') return { open, ...returnTo }
  if (open === 'connection' && typeof connectionId === 'string') return { open, connectionId, ...returnTo }
  return null
}

/**
 * What the account page reads on arrival to open its bank link flow over the page, chosen on a
 * connection when one is named. The account page's arrival state takes the same fields
 */
export type BankLinkArrival = { linkBank: true; linkConnectionId?: string }

/** Goes back to the account a link flow sent to Settings, reopening its flow on the connection just made */
export function returnToBankLink(navigate: NavigateFunction, accountId: string, connectionId: string) {
  const arrival: BankLinkArrival = { linkBank: true, linkConnectionId: connectionId }
  navigate(`/accounts/${accountId}`, { state: arrival })
}
