import { useCallback, useState } from 'react'
import { Bookmark, Calendar, Coins, Store, Tag, Wallet } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { OptionItem } from '@/components/filters/OptionList'
import { useAccounts } from '@/api/accounts'
import { useCurrencies } from '@/api/currency'
import { useAuth } from '@/hooks/useAuth'
import type { TransactionListFilters } from '@/pages/transactions/types/transactionList'
import type { TransactionFilterSetter } from '@/pages/transactions/components/toolbar/types'

// Lightly damped spring matching the insights range pill so both controls share a settle feel
export const FILTER_GLASS_SPRING = { type: 'spring', stiffness: 420, damping: 34, mass: 0.9 } as const

export type FacetKind = 'multi' | 'amount' | 'date'

export type FacetConfig = {
  id: string
  label: string
  icon: LucideIcon
  kind: FacetKind
}

// Currency keeps at most one value even though it is now edited inside the amount section rather
// than as its own facet, so picking another replaces the previous one
const SINGLE_SELECT_FACET_IDS = new Set(['currency'])

export const FILTER_FACETS: FacetConfig[] = [
  { id: 'accounts', label: 'Accounts', icon: Wallet, kind: 'multi' },
  { id: 'categories', label: 'Category', icon: Tag, kind: 'multi' },
  { id: 'merchants', label: 'Merchant', icon: Store, kind: 'multi' },
  { id: 'tags', label: 'Tags', icon: Bookmark, kind: 'multi' },
  { id: 'amount', label: 'Amount', icon: Coins, kind: 'amount' },
  { id: 'date', label: 'Date', icon: Calendar, kind: 'date' },
]

export type MultiSelections = Record<string, string[]>

export type AmountDraft = { min: string; max: string }

const EMPTY_SELECTIONS: MultiSelections = {
  accounts: [],
  categories: [],
  merchants: [],
  tags: [],
  currency: [],
}

type UseTransactionFilterDraftArgs = {
  filters: TransactionListFilters
  setFilter: TransactionFilterSetter
  accountOptions: OptionItem[]
  categoryOptions: OptionItem[]
  // Called after Apply or Clear so each presentation can close its own surface
  onClose: () => void
}

export type TransactionFilterDraft = ReturnType<typeof useTransactionFilterDraft>

/**
 * Owns the transaction filter draft shared by the desktop pill and the mobile sheet: the in-progress
 * selections, the option lists, and the commit, clear, and reseed actions
 */
export function useTransactionFilterDraft({
  filters,
  setFilter,
  accountOptions,
  categoryOptions,
  onClose,
}: UseTransactionFilterDraftArgs) {
  const [selections, setSelections] = useState<MultiSelections>(EMPTY_SELECTIONS)
  const [tagMatch, setTagMatch] = useState<'all' | 'any'>('all')
  // Resolved names for selected merchants and tags, kept so the summary and the pinned rows stay
  // readable after the server search moves on
  const [referenceLabels, setReferenceLabels] = useState<Record<string, string>>({})
  const [amount, setAmount] = useState<AmountDraft>({ min: '', max: '' })
  const [dateRange, setDateRange] = useState({ from: '', to: '' })
  const { user } = useAuth()
  const { data: currencies = [] } = useCurrencies()
  const { data: accounts = [] } = useAccounts()

  // The currency filter offers the currencies the user's accounts actually use rather than every
  // ISO currency, and only one can be applied at a time
  const accountCurrencyCodes = Array.from(new Set(accounts.map((account) => account.currency)))
  const currencyOptions: OptionItem[] = accountCurrencyCodes.map((code) => ({ value: code, label: code }))
  const baseCurrency = user?.base_currency ?? ''

  // The amount range matches within one currency: the selected currency filter, or the base
  // currency when none is chosen, so the user never picks a currency twice
  const amountCurrency = selections.currency[0] ?? baseCurrency
  const amountSymbol = currencies.find((currency) => currency.id === amountCurrency)?.symbol ?? ''
  const amountCurrencyNote = selections.currency[0]
    ? `Amounts are matched in ${amountCurrency}, from the currency filter`
    : `Amounts are matched in ${amountCurrency}, your base currency`

  /**
   * Counts the live selections on a facet so its tab can show a badge and the pill can show a total
   */
  function countFacet(facet: FacetConfig): number {
    if (facet.kind === 'multi') return selections[facet.id].length

    // The amount section also owns the currency filter, so a chosen currency and an entered range
    // each count toward its badge
    if (facet.kind === 'amount') {
      return selections.currency.length + (amount.min || amount.max ? 1 : 0)
    }
    return dateRange.from || dateRange.to ? 1 : 0
  }

  const activeFacetCount = FILTER_FACETS.filter((facet) => countFacet(facet) > 0).length

  /**
   * Returns the client-side option list backing a facet, empty for the server-searched merchant and
   * tag facets
   */
  function getFacetOptions(facetId: string): OptionItem[] {
    if (facetId === 'accounts') return accountOptions
    if (facetId === 'categories') return categoryOptions
    if (facetId === 'currency') return currencyOptions
    return []
  }

  /**
   * Reseeds the draft from the applied filters so opening starts clean and dismissing discards any
   * uncommitted edits
   */
  const seedDraftFromFilters = useCallback(() => {
    setSelections({
      ...EMPTY_SELECTIONS,
      accounts: filters.account_id ?? [],
      categories: filters.category_id ?? [],
      merchants: filters.merchant_id ?? [],
      tags: filters.tag_id ?? [],
      currency: filters.currency ? [filters.currency] : [],
    })
    setTagMatch(filters.tag_match ?? 'all')
    setDateRange({ from: filters.from_date ?? '', to: filters.to_date ?? '' })
    // Stored bounds are in the amount currency's minor units, so they are scaled back to a decimal
    const exponent = currencies.find((currency) => currency.id === filters.amount_currency)?.minor_unit_exponent ?? 2
    const toInput = (value?: number) => (value === undefined ? '' : String(value / 10 ** exponent))
    setAmount({ min: toInput(filters.min_amount), max: toInput(filters.max_amount) })
  }, [filters, currencies])

  /**
   * Adds or removes a value from a facet draft, recording the label for server-searched facets
   */
  function toggleSelection(facetId: string, value: string, label?: string) {
    setSelections((current) => {
      const values = current[facetId]
      const isSingle = SINGLE_SELECT_FACET_IDS.has(facetId)

      // A single-select facet keeps only the picked value, toggling off when the same one is tapped
      if (isSingle) {
        return { ...current, [facetId]: values.includes(value) ? [] : [value] }
      }
      const next = values.includes(value)
        ? values.filter((entry) => entry !== value)
        : [...values, value]
      return { ...current, [facetId]: next }
    })

    if (label !== undefined) {
      setReferenceLabels((current) => ({ ...current, [value]: label }))
    }
  }

  /**
   * Clears every applied filter the list endpoint honours and closes the surface
   */
  function clearAll() {
    setSelections(EMPTY_SELECTIONS)
    setAmount({ min: '', max: '' })
    setDateRange({ from: '', to: '' })
    setFilter({
      account_id: undefined,
      category_id: undefined,
      merchant_id: undefined,
      tag_id: undefined,
      tag_match: undefined,
      currency: undefined,
      min_amount: undefined,
      max_amount: undefined,
      amount_currency: undefined,
      from_date: undefined,
      to_date: undefined,
    })
    onClose()
  }

  /**
   * Commits the draft to the applied filters, converting the amount bounds into the matched
   * currency's minor units, then closes the surface
   */
  function applyFilters() {
    const exponent = currencies.find((currency) => currency.id === amountCurrency)?.minor_unit_exponent ?? 2
    const toMinor = (value: string) => (value.trim() ? Math.round(Number(value) * 10 ** exponent) : undefined)
    const hasAmount = Boolean(amount.min.trim() || amount.max.trim())

    setFilter({
      account_id: selections.accounts,
      category_id: selections.categories,
      merchant_id: selections.merchants,
      tag_id: selections.tags,
      tag_match: selections.tags.length > 0 ? tagMatch : undefined,
      currency: selections.currency[0],
      min_amount: toMinor(amount.min),
      max_amount: toMinor(amount.max),
      amount_currency: hasAmount ? amountCurrency : undefined,
      from_date: dateRange.from || undefined,
      to_date: dateRange.to || undefined,
    })
    onClose()
  }

  return {
    selections,
    tagMatch,
    referenceLabels,
    amount,
    dateRange,
    activeFacetCount,
    amountSymbol,
    amountCurrencyNote,
    getFacetOptions,
    countFacet,
    toggleSelection,
    setTagMatch,
    setAmount,
    setDateRange,
    seedDraftFromFilters,
    applyFilters,
    clearAll,
  }
}
