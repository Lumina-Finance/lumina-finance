import { useCallback, useState } from 'react'
import { Landmark, Layers, Wallet } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { OptionItem } from '@/components/filters/OptionList'
import type { AccountKind, AccountType } from '@/api/accounts'
import type { FilterValues } from '@/pages/accounts/types/accounts'

// Lightly damped spring shared with the transaction filter pill and the insights range control so
// every glass surface settles with the same feel
export const FILTER_GLASS_SPRING = { type: 'spring', stiffness: 420, damping: 34, mass: 0.9 } as const

export type FacetId = keyof FilterValues

export type FacetConfig = {
  id: FacetId
  label: string
  icon: LucideIcon
}

export const FILTER_FACETS: FacetConfig[] = [
  { id: 'institution_id', label: 'Institution', icon: Landmark },
  { id: 'account_kind', label: 'Category', icon: Layers },
  { id: 'account_type', label: 'Type', icon: Wallet },
]

export type FacetSelections = Record<FacetId, string[]>

const EMPTY_SELECTIONS: FacetSelections = {
  institution_id: [],
  account_kind: [],
  account_type: [],
}

type UseAccountFilterDraftArgs = {
  filters: FilterValues
  setFilter: (patch: Partial<FilterValues>) => void
  institutionOptions: OptionItem[]
  kindOptions: OptionItem[]
  typeOptions: OptionItem[]
  // Called after Apply or Clear so each presentation can close its own surface
  onClose: () => void
}

export type AccountFilterDraft = ReturnType<typeof useAccountFilterDraft>

/**
 * Owns the account filter draft shared by the desktop pill and the mobile sheet: the in-progress
 * selections, the option lists, and the commit, clear, and reseed actions
 */
export function useAccountFilterDraft({
  filters,
  setFilter,
  institutionOptions,
  kindOptions,
  typeOptions,
  onClose,
}: UseAccountFilterDraftArgs) {
  const [selections, setSelections] = useState<FacetSelections>(EMPTY_SELECTIONS)

  /**
   * Returns the option list backing a facet so its editor and chips can resolve labels
   */
  function getFacetOptions(facetId: FacetId): OptionItem[] {
    if (facetId === 'institution_id') return institutionOptions
    if (facetId === 'account_kind') return kindOptions
    return typeOptions
  }

  /**
   * Counts the live selections on a facet so its tab can show a badge and the pill can show a total
   */
  function countFacet(facet: FacetConfig): number {
    return selections[facet.id].length
  }

  const activeFacetCount = FILTER_FACETS.filter((facet) => countFacet(facet) > 0).length

  /**
   * Reseeds the draft from the applied filters so opening starts clean and dismissing discards any
   * uncommitted edits
   */
  const seedDraftFromFilters = useCallback(() => {
    setSelections({
      institution_id: filters.institution_id ?? [],
      account_kind: filters.account_kind ?? [],
      account_type: filters.account_type ?? [],
    })
  }, [filters])

  /**
   * Adds or removes a value from a facet draft
   */
  function toggleSelection(facetId: FacetId, value: string) {
    setSelections((current) => {
      const values = current[facetId]
      const next = values.includes(value)
        ? values.filter((entry) => entry !== value)
        : [...values, value]
      return { ...current, [facetId]: next }
    })
  }

  /**
   * Clears every applied facet and closes the surface
   */
  function clearAll() {
    setSelections(EMPTY_SELECTIONS)
    setFilter({ institution_id: [], account_kind: [], account_type: [] })
    onClose()
  }

  /**
   * Commits the draft to the applied filters, then closes the surface
   */
  function applyFilters() {
    setFilter({
      institution_id: selections.institution_id,
      account_kind: selections.account_kind as AccountKind[],
      account_type: selections.account_type as AccountType[],
    })
    onClose()
  }

  return {
    selections,
    activeFacetCount,
    getFacetOptions,
    countFacet,
    toggleSelection,
    seedDraftFromFilters,
    applyFilters,
    clearAll,
  }
}
