import { type ReactNode } from 'react'
import { Check, ChevronDown, Info, TriangleAlert } from 'lucide-react'
import { IMPORT_INSET_STYLE } from '@/pages/imports/constants'

/**
 * Small labelled stat tile, rendering the value with tabular figures unless it is explicitly marked
 * as non-numeric
 */
export function ImportStat({ label, value, numeric = true }: { label: string; value: string; numeric?: boolean }) {
  return (
    <div className="min-w-0 px-3 py-1">
      <p className="truncate text-xs font-medium uppercase" style={{ color: 'var(--app-text-subtle)' }}>
        {label}
      </p>
      <p className={`truncate text-lg font-medium ${numeric ? 'font-financial tabular-nums' : ''}`}>{value}</p>
    </div>
  )
}

/**
 * Renders one numbered step of the import wizard, with an index badge and connecting line on the
 * left and a title, optional description, optional header action, and body content on the right
 */
export function ImportStep({
  index,
  title,
  description,
  action,
  className = '',
  contentClassName = 'space-y-3',
  children,
}: {
  index: string
  title: string
  description?: string
  action?: ReactNode
  className?: string
  contentClassName?: string
  children: ReactNode
}) {
  return (
    <section className={`grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3 ${className}`}>
      <div className="flex min-h-0 flex-col items-center">
        <span
          className="flex h-4 shrink-0 items-center text-xs font-semibold leading-none"
          style={{ color: 'var(--app-accent)' }}
          aria-hidden
        >
          {index}
        </span>
        <span
          className="mt-1 w-px flex-1"
          style={{ backgroundColor: 'var(--app-border-strong)' }}
          aria-hidden
        />
      </div>

      <div className={`min-w-0 pb-1 ${contentClassName}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>
              {title}
            </p>
            {description && (
              <p className="mt-1 text-sm leading-5" style={{ color: 'var(--app-text-muted)' }}>
                {description}
              </p>
            )}
          </div>
          {action}
        </div>
        {children}
      </div>
    </section>
  )
}

/**
 * Icon button that expands or collapses a section, rotating its chevron to match the current state
 */
export function ImportCollapseToggle({
  expanded,
  label,
  onClick,
}: {
  expanded: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="app-icon-button h-9 w-9 shrink-0"
      onClick={onClick}
      aria-label={label}
      aria-expanded={expanded}
    >
      <ChevronDown
        size={17}
        className="transition-transform duration-150"
        style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
        aria-hidden
      />
    </button>
  )
}

/**
 * Placeholder shown in place of an import table or list when it has nothing to display yet
 */
export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div
      className="px-4 py-4 text-center"
      style={{
        ...IMPORT_INSET_STYLE,
        color: 'var(--app-text-subtle)',
      }}
    >
      <p className="text-sm font-medium" style={{ color: 'var(--app-text-muted)' }}>
        {title}
      </p>
      <p className="mt-1 text-sm">{description}</p>
    </div>
  )
}

/**
 * Shown in place of a mapping step whose reference list could not be loaded
 *
 * The step is taken away rather than left operable, since answering it against a list with nothing
 * in it maps everything to a new record and the import then duplicates what the user already has
 */
export function ImportLoadFailure({
  title,
  description,
  onRetry,
}: {
  title: string
  description: string
  onRetry: () => void
}) {
  return (
    <div
      className="flex flex-col items-center gap-3 px-4 py-6 text-center"
      style={{ ...IMPORT_INSET_STYLE, color: 'var(--app-text-muted)' }}
      role="alert"
    >
      <span
        className="flex h-10 w-10 items-center justify-center"
        style={{ background: 'var(--app-negative-soft)', color: 'var(--app-negative)' }}
        aria-hidden
      >
        <TriangleAlert size={19} strokeWidth={2.25} />
      </span>
      <div className="min-w-0">
        <p className="text-[0.9375rem] font-semibold" style={{ color: 'var(--app-negative)' }}>
          {title}
        </p>
        <p className="mt-1 text-sm leading-5">{description}</p>
      </div>
      <button type="button" className="app-secondary-button h-9" onClick={onRetry}>
        Try again
      </button>
    </div>
  )
}

/**
 * Warning panel beside an import step, saying what the import will do with something rather than
 * asking anything
 *
 * The title says which of those it is about, since a step can carry more than one and they would
 * otherwise be told apart only by reading them
 */
export function ImportNotice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      className="flex items-start gap-3 rounded-lg px-4 py-3"
      style={{
        ...IMPORT_INSET_STYLE,
        color: 'var(--app-text-muted)',
      }}
    >
      <span
        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center"
        style={{ color: 'var(--app-warning-text)' }}
        aria-hidden
      >
        <TriangleAlert size={16} strokeWidth={2.25} />
      </span>
      <div className="min-w-0">
        <p className="text-[0.9375rem] font-semibold leading-5" style={{ color: 'var(--app-text)' }}>
          {title}
        </p>
        <p className="mt-1 text-sm leading-5">
          {children}
        </p>
      </div>
    </div>
  )
}

/**
 * Info panel pairing a title with body text beside an accent info icon, used to surface neutral
 * guidance next to an import step
 */
export function ImportInfoCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      className="flex items-start gap-3 rounded-lg px-4 py-3"
      style={{
        ...IMPORT_INSET_STYLE,
        color: 'var(--app-text-muted)',
      }}
    >
      <span
        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center"
        style={{ color: 'var(--app-accent)' }}
        aria-hidden
      >
        <Info size={16} strokeWidth={2.25} />
      </span>
      <div className="min-w-0">
        <p className="text-[0.9375rem] font-semibold leading-5" style={{ color: 'var(--app-text)' }}>
          {title}
        </p>
        <p className="mt-1 text-sm leading-5">
          {children}
        </p>
      </div>
    </div>
  )
}

/**
 * Checkbox button used across import tables, supporting a mixed state for a row selection that is
 * only partially checked
 */
export function ImportCheckbox({
  checked,
  disabled,
  indeterminate = false,
  label,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  indeterminate?: boolean
  label: string
  onChange: () => void
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={label}
      className="mx-auto flex h-5 w-5 items-center justify-center rounded-lg transition-opacity duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      style={{
        background: checked || indeterminate ? 'var(--app-accent)' : 'var(--app-input-bg)',
        border: `1px solid ${checked || indeterminate ? 'var(--app-accent)' : 'var(--app-border-strong)'}`,
        color: 'var(--app-button-primary-text)',
        opacity: disabled ? 0.38 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      onClick={onChange}
      disabled={disabled}
    >
      {checked && <Check size={13} strokeWidth={3} aria-hidden />}
      {!checked && indeterminate && (
        <span className="h-0.5 w-2.5 rounded-full" style={{ background: 'currentColor' }} aria-hidden />
      )}
    </button>
  )
}

