import type { SnapshotGranularity } from '@/api/accounts'

export const ACCOUNT_KIND_LABEL: Record<string, string> = {
  asset: 'Asset',
  revolving: 'Revolving credit',
  amortizing: 'Amortizing debt',
}

export const EASE = [0.25, 0.1, 0.25, 1] as const

// An account already in the cache resolves in a few milliseconds, so the loading skeleton waits
// this long before appearing rather than flickering through a load nobody perceives as slow
export const ACCOUNT_SKELETON_DELAY_MS = 150

// Once the skeleton is on screen it stays for at least this long, so an account arriving just
// after it appears does not replace it mid-blink
export const ACCOUNT_SKELETON_MINIMUM_MS = 800

export const EDIT_ACCOUNT_IDENTITY_FIELD_IDS = {
  name: 'edit-account-name',
  institution: 'edit-account-institution',
  taxAdvantagedCategory: 'edit-account-tax-advantaged-category',
  creditLimit: 'edit-credit-limit',
  archive: 'edit-account-archived',
  deleteName: 'delete-account-name',
} as const

export type BalanceRange = '7D' | '30D' | '90D' | '1Y'
export type BalanceChartMode = 'balance' | 'change'
export const BALANCE_RANGES: BalanceRange[] = ['7D', '30D', '90D', '1Y']
export const TIME_SELECTOR_SPRING = { type: 'spring', stiffness: 420, damping: 34, mass: 0.7 } as const
export const RANGE_CONFIG: Record<
  BalanceRange,
  { days: number; granularity: SnapshotGranularity }
> = {
  '7D': { days: 7, granularity: 'day' },
  '30D': { days: 30, granularity: 'day' },
  '90D': { days: 90, granularity: 'week' },
  '1Y': { days: 365, granularity: 'month' },
}
