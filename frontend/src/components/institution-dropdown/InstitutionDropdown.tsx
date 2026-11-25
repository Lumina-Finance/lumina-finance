import { useMemo } from 'react'
import { useInfiniteInstitutions, useInstitution, type Institution } from '@/api/institutions'
import Dropdown from '@/components/dropdown/Dropdown'
import type { DropdownSize } from '@/components/dropdown/types'
import {
  buildInstitutionOptions,
  buildSelectedInstitutionOption,
  findSelectedInstitution,
} from '@/components/institution-dropdown/utils/options'
import { useDebouncedReferenceSearch } from '@/components/transactions/transaction-modal/hooks/useDebouncedReferenceSearch'
import { usePagedReferenceDropdown } from '@/components/transactions/transaction-modal/hooks/usePagedReferenceDropdown'
import { FETCHING_MORE_TEXT_MIN_MS, LOADING_TEXT_MIN_MS } from '@/utils/timing'

/** How long typing must pause before the search is sent, so each keystroke is not a request */
const INSTITUTION_SEARCH_DEBOUNCE_MS = 300

// Stands in for a field nothing is chosen in, and is neither an institution's ID nor the blank "None"
const NOTHING_CHOSEN_VALUE = '__nothing_chosen__'

interface InstitutionDropdownProps {
  id?: string
  labelledBy?: string
  placeholder?: string
  size?: DropdownSize
  className?: string
  disabled?: boolean
  blankWhenEmpty?: boolean

  /**
   * The chosen institution's ID, an empty string for an account with no institution, or null for a
   * field nothing has been chosen in yet. Null shows the placeholder rather than "None"
   */
  value: string | null
  onChange: (institutionId: string) => void

  /**
   * The institution `value` names, when the caller already holds it, such as the one an account
   * carries. It saves a request for a selection that is not on the first page
   */
  selectedInstitution?: Institution | null

  /** Called with the search text when the user chooses to add an institution. Leaving it out hides the action */
  onCreate?: (query: string) => void

  /** Called with an institution when the user chooses to correct it. Leaving it out hides the action */
  onCorrect?: (institution: Institution) => void
}

/**
 * Picks an institution from the shared table, one page at a time
 *
 * Every user's institutions sit in one table that anyone may add to, so the list is searched on the
 * server as the user types and read further as the list is scrolled, and the chosen institution is
 * shown by its ID wherever it sits in that table
 */
export function InstitutionDropdown({
  id,
  labelledBy,
  placeholder = 'Select institution...',
  size,
  className,
  disabled,
  blankWhenEmpty,
  value,
  onChange,
  selectedInstitution,
  onCreate,
  onCorrect,
}: InstitutionDropdownProps) {
  const search = useDebouncedReferenceSearch(INSTITUTION_SEARCH_DEBOUNCE_MS)
  const query = useInfiniteInstitutions({ q: search.activeSearchText || undefined })
  const paged = usePagedReferenceDropdown({
    query,
    activeSearchText: search.activeSearchText,
    searchLoadingMinMs: LOADING_TEXT_MIN_MS,
    fetchingMoreMinMs: FETCHING_MORE_TEXT_MIN_MS,
    idleLoadingText: 'Loading institutions...',
  })

  // A value no option carries leaves the trigger showing the placeholder
  const dropdownValue = value ?? NOTHING_CHOSEN_VALUE
  const loadedInstitution = findSelectedInstitution(dropdownValue, paged.fetchedItems, selectedInstitution, undefined)
  const { data: fetchedInstitution } = useInstitution(value, value !== null && value !== '' && !loadedInstitution)
  const selectedOption = buildSelectedInstitutionOption(
    dropdownValue,
    findSelectedInstitution(dropdownValue, paged.fetchedItems, selectedInstitution, fetchedInstitution),
  )

  const options = useMemo(
    () => buildInstitutionOptions(paged.visibleItems, search.search.trim() !== ''),
    [paged.visibleItems, search.search],
  )

  const handleEdit = onCorrect
    ? (institutionId: string) => {
        const institution = paged.visibleItems.find((candidate) => candidate.id === institutionId)
        if (institution) onCorrect(institution)
      }
    : undefined

  return (
    <Dropdown
      id={id}
      labelledBy={labelledBy}
      options={options}
      selectedOption={selectedOption}
      value={dropdownValue}
      onChange={onChange}
      placeholder={placeholder}
      size={size}
      className={className}
      disabled={disabled}
      blankWhenEmpty={blankWhenEmpty}
      searchable
      searchPlaceholder="Search institutions..."
      searchValue={search.search}
      onSearchChange={search.setSearch}
      onSearchCommit={search.setActiveSearch}
      filterOptions={false}
      isLoading={paged.showLoading}
      loadingText={paged.loadingText}
      loadingMinMs={0}
      hideOptionsWhileLoading={paged.showInitialLoading}
      autoHighlightFirstOption
      selectHighlightedOnSearchEnter={search.isSettled && paged.answersSearch}
      hasMore={!!query.hasNextPage}
      onLoadMore={paged.loadMore}
      onCreateNew={onCreate}
      createNewLabel={(text) => (text ? `Create institution "${text}"` : 'Create institution')}
      onEditOption={handleEdit}
      editOptionLabel="Correct institution"
    />
  )
}
