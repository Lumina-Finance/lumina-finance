import type { AccountBankStatus, BankConnection, BankProvidersResponse } from '@/api/bank-sync'
import { NOTHING_TO_LINK_REASON } from '@/components/bank-link-flow/constants'

/**
 * Why the flow links an account: its first link, a link made again after it was unlinked, or its
 * bank account chosen again after the provider started listing it differently
 */
export type LinkFlowMode = 'link' | 'relink' | 'choose_again'

export type LinkFlowStep = 'connect-first' | 'account' | 'start'

/** Each step's name, which the flow shows as its eyebrow */
export const LINK_FLOW_STEP_NAMES: Record<LinkFlowStep, string> = {
  'connect-first': 'Connect a provider first',
  account: 'Choose the bank account',
  start: 'Choose where history starts',
}

/** The flow's title, its last button and the confirmation once it links, by why it links */
export const LINK_FLOW_WORDING: Record<LinkFlowMode, { title: string; submitLabel: string; confirmation: string }> = {
  link: { title: 'Link bank account', submitLabel: 'Link and import', confirmation: 'Linked. Importing history now.' },
  relink: { title: 'Reconnect bank account', submitLabel: 'Relink', confirmation: 'Relinked. Catching up now.' },
  choose_again: {
    title: 'Choose bank account again',
    submitLabel: 'Relink',
    confirmation: 'Relinked. Catching up now.',
  },
}

/** The bank account an account followed before, which the flow names so the user can find it again */
export type PreviousBankAccount = {
  externalAccountId: string
  name: string
  institution: string
  providerName: string
}

/**
 * Why the flow links the account, from the account's own link: a link waiting for its bank account
 * to be chosen again keeps it, and an account linked before relinks
 */
export function getLinkFlowMode(status: AccountBankStatus): LinkFlowMode {
  if (status.link?.state === 'choose_account') return 'choose_again'
  return status.previous_link ? 'relink' : 'link'
}

/**
 * The working connection whose bank accounts the flow lists: the one the user switched to, else the
 * connection a link waiting for its bank account to be chosen again came from, else the first
 */
export function pickListedConnection(
  working: BankConnection[],
  switchedId: string | null,
  status: AccountBankStatus | undefined,
): BankConnection | undefined {
  const waitingId = status?.link?.state === 'choose_account' ? status.link.connection_id : null
  return (
    working.find((entry) => entry.id === switchedId) ?? working.find((entry) => entry.id === waitingId) ?? working[0]
  )
}

/**
 * The bank account the account followed before, which a relink or a choice made again compares the
 * listed ones with, or null for a first link
 */
export function findPreviousBankAccount(status: AccountBankStatus): PreviousBankAccount | null {
  const before = status.link?.state === 'choose_account' ? status.link : status.previous_link
  if (!before) return null
  return {
    externalAccountId: before.external_account_id,
    name: before.external_account_name,
    institution: before.institution_name,
    providerName: before.provider_name,
  }
}

/**
 * What the flow says when the user has no connection that can link, and whether Settings can help:
 * a rejected connection is reconnected there, and a new one is added there while a provider is open
 * to new connections
 */
export function describeConnectFirst(
  connections: BankConnection[],
  providers: BankProvidersResponse,
): { message: string; canOpenSettings: boolean } {
  if (connections.some((connection) => connection.status === 'credential_rejected')) {
    return {
      message:
        'Your bank connection needs a new setup token before it can link accounts. Reconnect it in Settings, then come back here.',
      canOpenSettings: true,
    }
  }
  if (!providers.providers.some((provider) => provider.offered))
    return { message: NOTHING_TO_LINK_REASON, canOpenSettings: false }
  return {
    message:
      'Add a bank connection in Settings first. One connection reaches every bank account you hold with that provider, and each account then chooses one of them here.',
    canOpenSettings: true,
  }
}
