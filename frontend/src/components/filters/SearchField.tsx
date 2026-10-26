import { Search } from 'lucide-react'

type SearchFieldProps = {
  value: string
  placeholder: string
  onChange: (value: string) => void
}

/**
 * Renders the search field above a filter checklist. The input sits inside the framed box, so the box
 * takes the field focus border on the input's behalf
 */
export function SearchField({ value, placeholder, onChange }: SearchFieldProps) {
  return (
    <div className="app-input app-field-focus grid grid-cols-[2.25rem_minmax(0,1fr)] items-center overflow-hidden px-0 py-0">
      <span className="pointer-events-none flex h-9 w-9 items-center justify-center">
        <Search size={14} style={{ color: 'var(--app-text-subtle)' }} aria-hidden />
      </span>
      <input
        type="text"
        className="h-9 min-w-0 bg-transparent pr-3 text-[0.8125rem] outline-none"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}
