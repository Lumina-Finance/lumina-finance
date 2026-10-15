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
  // Marks the field as rejected by its form, with the id of the message saying why
  invalid?: boolean
  describedBy?: string
  // Called on Enter for the surfaces that commit the search on submit instead of filtering as the
  // user types
  onSubmit?: () => void
}

/**
 * Renders the shared search field: a leading search glyph over the pill-shaped input, which takes
 * the ordinary input background, fixed to the 44px control height used across the toolbars,
 * settings, and modals
 */
export function GlassSearchField({
  value,
  onValueChange,
  placeholder,
  wrapperClassName,
  inputId,
  disabled,
  invalid,
  describedBy,
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
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={onSubmit ? (event) => { if (event.key === 'Enter') onSubmit() } : undefined}
      />
    </div>
  )
}
