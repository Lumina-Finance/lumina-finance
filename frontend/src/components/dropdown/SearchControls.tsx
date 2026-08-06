import type { ChangeEvent, KeyboardEvent, RefObject } from 'react'
import { Pencil, Plus } from 'lucide-react'

interface DropdownSearchControlsProps {
  createNewLabel: string
  editSelectedLabel: string | undefined
  searchPlaceholder: string
  searchRef: RefObject<HTMLInputElement | null>
  searchText: string
  showCreateAction: boolean
  showEditAction: boolean
  onCreateNew: () => void
  onEditSelected: () => void
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
  onSearchChange: (value: string) => void
}

const DEFAULT_EDIT_SELECTED_LABEL = 'Edit selected'

/**
 * Renders the searchable dropdown input and its optional create and edit actions inside the open box
 */
export function DropdownSearchControls({
  createNewLabel,
  editSelectedLabel,
  searchPlaceholder,
  searchRef,
  searchText,
  showCreateAction,
  showEditAction,
  onCreateNew,
  onEditSelected,
  onKeyDown,
  onSearchChange,
}: DropdownSearchControlsProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onSearchChange(event.target.value)
  }

  const resolvedEditSelectedLabel = editSelectedLabel ?? DEFAULT_EDIT_SELECTED_LABEL

  return (
    // The box is only as wide as the field it opened from, and an import table's institution
    // column is narrow enough that two action buttons would leave the search box unusable, so
    // they drop to a line of their own rather than squeezing it
    <div className="flex flex-wrap gap-2 px-2 pb-2 pt-2">
      <input
        ref={searchRef}
        type="text"
        data-dropdown-search="true"
        className="app-input min-w-[7rem] flex-1"
        style={{ fontSize: '0.8125rem' }}
        placeholder={searchPlaceholder}
        value={searchText}
        onChange={handleChange}
        onKeyDown={onKeyDown}
      />
      {showCreateAction && (
        <button
          type="button"
          className="app-icon-button h-10 w-10 shrink-0"
          style={{ color: 'var(--app-accent)' }}
          aria-label={createNewLabel}
          title={createNewLabel}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onCreateNew}
        >
          <Plus size={18} aria-hidden />
        </button>
      )}
      {showEditAction && (
        <button
          type="button"
          className="app-icon-button h-10 w-10 shrink-0"
          style={{ color: 'var(--app-accent)' }}
          aria-label={resolvedEditSelectedLabel}
          title={resolvedEditSelectedLabel}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onEditSelected}
        >
          <Pencil size={16} aria-hidden />
        </button>
      )}
    </div>
  )
}
