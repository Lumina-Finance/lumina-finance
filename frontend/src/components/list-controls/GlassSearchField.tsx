import { Search } from 'lucide-react'
import { joinClassNames } from '@/utils/classNames'

type GlassSearchFieldProps = {
  value: string
  onValueChange: (value: string) => void
  placeholder: string
  // Extra wrapper classes carrying the per-surface layout, such as the sticky toolbar margins or a
  // modal section's flex sizing
  wrapperClassName?: string
  inputId?: string
  disabled?: boolean
  // Called on Enter for the surfaces that commit the search on submit instead of filtering as the
  // user types
  onSubmit?: () => void
}

/**
 * Renders the shared glass search field: a leading search glyph over the translucent glass input,
 * fixed to the 44px control height used across the toolbars, settings, and modals
 */
export function GlassSearchField({
  value,
  onValueChange,
  placeholder,
  wrapperClassName,
  inputId,
  disabled,
  onSubmit,
}: GlassSearchFieldProps) {
  return (
    <div className={joinClassNames('relative min-w-0', wrapperClassName)}>
      <Search
        size={16}
        className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2"
        style={{ color: 'var(--app-text-subtle)' }}
        aria-hidden
      />
      <input
        id={inputId}
        type="text"
        className="app-glass-input h-11 w-full pl-9"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={onSubmit ? (event) => { if (event.key === 'Enter') onSubmit() } : undefined}
      />
    </div>
  )
}
