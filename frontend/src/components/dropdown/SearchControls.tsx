import type { ChangeEvent, KeyboardEvent, RefObject } from 'react'
import { Plus } from 'lucide-react'

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
 * Renders the searchable dropdown input and optional create action inside the floating menu
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
    <div className="flex gap-2 px-2 pb-2 pt-2">
      <input
        ref={searchRef}
        type="text"
        data-dropdown-search="true"
        className="app-input min-w-0 flex-1"
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
    </div>
  )
}
