import { useMemo } from 'react'
import type { LucideIcon } from 'lucide-react'
import Dropdown from '@/components/dropdown/Dropdown'
import type { DropdownOption } from '@/components/dropdown/types'

// Stable empty set so a caller with no disabled facets never allocates one each render
const NO_DISABLED_FACET_IDS = new Set<string>()

export type FacetSelectOption = {
  id: string
  label: string
  icon: LucideIcon
}

type FacetSelectDropdownProps<Facet extends FacetSelectOption> = {
  facets: Facet[]
  activeFacetId: Facet['id']
  countFacet: (facet: Facet) => number
  // Facet ids the caller has scoped away, greyed out and inert in the menu
  disabledFacetIds?: Set<string>
  onSelect: (facetId: Facet['id']) => void
}

/**
 * Renders the facet picker as a dropdown for a mobile full-screen filter panel, where the facet tab
 * grid is too cramped. The menu keeps the per-facet active-filter counts so the user can still tell
 * which facets carry filters without opening each one, and greys out any facet the caller marks
 * disabled. Shared by the account and transaction filter panels, which pass their own facet list and
 * counting function
 */
export function FacetSelectDropdown<Facet extends FacetSelectOption>({
  facets,
  activeFacetId,
  countFacet,
  disabledFacetIds = NO_DISABLED_FACET_IDS,
  onSelect,
}: FacetSelectDropdownProps<Facet>) {
  const options = useMemo<DropdownOption[]>(() => facets.map((facet) => {
    const FacetIcon = facet.icon
    const disabled = disabledFacetIds.has(facet.id)
    const count = countFacet(facet)

    return {
      value: facet.id,
      label: facet.label,
      icon: <FacetIcon size={16} aria-hidden className="shrink-0" />,
      // A facet the caller has scoped away holds no filters that still apply, so its count would
      // describe a state the user cannot reach
      count: !disabled && count > 0 ? count : undefined,
      disabled,
    }
  }), [countFacet, disabledFacetIds, facets])

  // An id the caller no longer offers falls back to the first entry, so the head keeps showing a real
  // choice with its icon and count rather than dropping to placeholder text
  const resolvedValue = facets.some((facet) => facet.id === activeFacetId)
    ? activeFacetId
    : facets[0]?.id ?? ''

  return (
    <Dropdown
      options={options}
      value={resolvedValue}
      onChange={onSelect}
    />
  )
}
