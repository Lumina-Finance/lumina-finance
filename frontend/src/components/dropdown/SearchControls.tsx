import type { ChangeEvent, KeyboardEvent, RefObject } from 'react'
import { Plus, Search } from 'lucide-react'

interface DropdownSearchControlsProps {
  createNewLabel: string
  searchPlaceholder: string
  searchRef: RefObject<HTMLInputElement | null>
  searchText: string
  showCreateAction: boolean
  onCreateNew: () => void
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void
  onSearchChange: (value: string) => void
}

/**
 * Renders the searchable dropdown input and optional create action inside the open box
 */
export function DropdownSearchControls({
  createNewLabel,
  searchPlaceholder,
  searchRef,
  searchText,
  showCreateAction,
  onCreateNew,
  onKeyDown,
  onSearchChange,
}: DropdownSearchControlsProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onSearchChange(event.target.value)
  }

  return (
    <div className="app-dropdown-search">
      <Search size={16} className="app-dropdown-search-icon" aria-hidden />
      <input
        ref={searchRef}
        type="text"
        // Left out of the fields a modal picks its opening focus from, in modal/focus.ts, since
        // this input belongs to the list rather than to the form around it
        data-dropdown-search="true"
        className="app-dropdown-search-input"
        placeholder={searchPlaceholder}
        value={searchText}
        onChange={handleChange}
        onKeyDown={onKeyDown}
      />
      {showCreateAction && (
        <button
          type="button"
          className="app-icon-button shrink-0"
          aria-label={createNewLabel}
          title={createNewLabel}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onCreateNew}
        >
          <Plus size={18} aria-hidden />
        </button>
      )}
    </div>
  )
}
