import { useCallback, useMemo, useState } from 'react'
import type { AccountKind, AccountType, AccountsOverview } from '@/api/accounts'
import type { OptionItem } from '@/components/FilterOptionList'
import type { AccountFilterValues } from '@/accounts/types/accounts'

const ACCOUNT_KIND_OPTIONS: OptionItem[] = [
  { value: 'asset', label: 'Assets' },
  { value: 'revolving', label: 'Revolving credit' },
  { value: 'amortizing', label: 'Amortizing debt' },
]

// Group labels mirror the account sections. Keeping the static ordering here
// avoids rebuilding display rules in the filter component.
const ACCOUNT_TYPE_OPTIONS: OptionItem[] = [
  { value: 'checking', label: 'Checking', group: 'Assets' },
  { value: 'savings', label: 'Savings', group: 'Assets' },
  { value: 'term_deposit', label: 'Term Deposit', group: 'Assets' },
  { value: 'cash', label: 'Cash', group: 'Assets' },
  { value: 'investment', label: 'Investment', group: 'Assets' },
  { value: 'credit_card', label: 'Credit Card', group: 'Revolving credit' },
  { value: 'line_of_credit', label: 'Line of Credit', group: 'Revolving credit' },
  { value: 'heloc', label: 'HELOC', group: 'Revolving credit' },
  { value: 'loan', label: 'Loan', group: 'Amortizing debt' },
  { value: 'mortgage', label: 'Mortgage', group: 'Amortizing debt' },
]

export function useAccountFilters(rows: AccountsOverview[]) {
  const [filters, setFilters] = useState<AccountFilterValues>({})

  const setFilter = useCallback((patch: Partial<AccountFilterValues>) => {
    setFilters((currentFilters) => {
      const nextFilters = { ...currentFilters, ...patch }
      for (const key of Object.keys(nextFilters) as (keyof AccountFilterValues)[]) {
        if (!nextFilters[key]) delete nextFilters[key]
      }
      return nextFilters
    })
  }, [])

  const institutionOptions = useMemo<OptionItem[]>(() => {
    const seen = new Map<string, string>()
    for (const account of rows) {
      if (account.institution) seen.set(account.institution.id, account.institution.name)
    }
    return Array.from(seen, ([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [rows])

  const accountKindOptions = useMemo<OptionItem[]>(() => {
    const present = new Set(rows.map((account) => account.account_kind))
    return ACCOUNT_KIND_OPTIONS.filter((option) => present.has(option.value as AccountKind))
  }, [rows])

  const accountTypeOptions = useMemo<OptionItem[]>(() => {
    const present = new Set(rows.map((account) => account.account_type))
    return ACCOUNT_TYPE_OPTIONS.filter((option) => present.has(option.value as AccountType))
  }, [rows])

  const filteredRows = useMemo(
    () => rows.filter((account) => {
      if (filters.institution_id && account.institution?.id !== filters.institution_id) return false
      if (filters.account_kind && account.account_kind !== filters.account_kind) return false
      if (filters.account_type && account.account_type !== filters.account_type) return false
      return true
    }),
    [filters, rows],
  )

  return {
    filters,
    setFilter,
    institutionOptions,
    accountKindOptions,
    accountTypeOptions,
    filteredRows,
  }
}
