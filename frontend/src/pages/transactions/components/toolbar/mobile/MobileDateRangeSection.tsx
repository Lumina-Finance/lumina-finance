import DateRangeFilterPanel from '@/components/filters/DateRangeFilterPanel'

type MobileDateRangeSectionProps = {
  selectedLabel: string | null
  from: string
  to: string
  changed: boolean
  invalid: boolean
  onFromChange: (value: string) => void
  onToChange: (value: string) => void
  onReset: () => void
  onApply: () => void
}

/**
 * Renders the transaction date range editor inside the mobile filter sheet
 */
export function MobileDateRangeSection({
  selectedLabel,
  from,
  to,
  changed,
  invalid,
  onFromChange,
  onToChange,
  onReset,
  onApply,
}: MobileDateRangeSectionProps) {
  return (
    <section>
      <div className="mb-3 min-w-0">
        <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--app-text-muted)' }}>
          Date range
        </h3>
        {selectedLabel && (
          <p className="mt-0.5 truncate text-sm" style={{ color: 'var(--app-accent)' }}>
            {selectedLabel}
          </p>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--app-border)' }}>
        <DateRangeFilterPanel
          from={from}
          to={to}
          changed={changed}
          invalid={invalid}
          onFromChange={onFromChange}
          onToChange={onToChange}
          onReset={onReset}
          onApply={onApply}
        />
      </div>
    </section>
  )
}
