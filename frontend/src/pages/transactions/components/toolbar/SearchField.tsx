import { Search } from 'lucide-react'

type TransactionSearchFieldProps = {
  search: string
  onSearchChange: (value: string) => void
  onSearchSubmit: () => void
  mobileSearchStuck: boolean
  desktopInlineLayout: boolean
}

/**
 * Renders the transaction search field with the responsive spacing owned by the sticky toolbar
 */
export function TransactionSearchField({
  search,
  onSearchChange,
  onSearchSubmit,
  mobileSearchStuck,
  desktopInlineLayout,
}: TransactionSearchFieldProps) {
  return (
    <div
      className={`relative min-w-0 transition-[margin-right] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${mobileSearchStuck ? 'max-[1049px]:mr-14' : 'max-[1049px]:mr-0'} ${desktopInlineLayout ? 'min-[750px]:min-w-80 min-[750px]:flex-1' : ''}`}
    >
      <Search
        size={16}
        className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2"
        style={{ color: 'var(--app-text-subtle)' }}
        aria-hidden
      />
      <input
        type="text"
        placeholder="Search transactions..."
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onSearchSubmit()
        }}
        className="app-glass-input h-11 w-full pl-9"
      />
    </div>
  )
}
