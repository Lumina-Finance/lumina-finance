import { useState } from 'react'
import { ArrowRight, RotateCcw } from 'lucide-react'

interface DateRangeFilterPanelProps {
  from: string
  to: string
  changed: boolean
  invalid: boolean
  onFromChange: (value: string) => void
  onToChange: (value: string) => void
  onReset: () => void
  onApply: () => void
}

interface DateRangePreset {
  label: string
  from: string
  to: string
}

function formatYmd(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseYmdLocal(ymd: string): Date {
  const [year, month, day] = ymd.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function addDays(ymd: string, days: number): string {
  const date = parseYmdLocal(ymd)
  date.setDate(date.getDate() + days)
  return formatYmd(date)
}

function getPresets(): DateRangePreset[] {
  const today = formatYmd(new Date())
  return [
    { label: 'Today', from: today, to: today },
    { label: '7D', from: addDays(today, -6), to: today },
    { label: '30D', from: addDays(today, -29), to: today },
    { label: 'MTD', from: `${today.slice(0, 7)}-01`, to: today },
    { label: 'YTD', from: `${today.slice(0, 4)}-01-01`, to: today },
  ]
}

function DateField({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  return (
    <input
      id={id}
      type="date"
      aria-label={id === 'date-range-from' ? 'Start date' : 'End date'}
      className="h-7 min-w-0 rounded-md border px-2 py-0 pr-1 text-[0.8125rem] font-medium outline-none transition-colors duration-150 focus:border-[var(--app-accent-border)] focus:shadow-[0_0_0_2px_var(--app-accent-soft)]"
      style={{
        background: 'color-mix(in srgb, var(--app-input-bg) 76%, var(--app-bg))',
        borderColor: 'var(--app-input-border)',
        color: 'var(--app-text)',
      }}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

export default function DateRangeFilterPanel({
  from,
  to,
  changed,
  invalid,
  onFromChange,
  onToChange,
  onReset,
  onApply,
}: DateRangeFilterPanelProps) {
  const presets = getPresets()
  const [activeShortcut, setActiveShortcut] = useState<string | null>(null)

  return (
    <div className="w-full overflow-hidden">
      <div className="space-y-3 px-4 py-3">
        <div className="grid grid-cols-5 gap-1">
          {presets.map((preset) => {
            const active = activeShortcut === preset.label
            return (
              <button
                key={preset.label}
                type="button"
                className="h-8 rounded-md border px-1.5 text-[0.8125rem] font-medium transition-colors duration-150 hover:bg-[var(--app-surface-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent-soft)]"
                style={{
                  background: active ? 'var(--app-accent-soft)' : 'var(--app-input-bg)',
                  borderColor: active ? 'var(--app-accent-border)' : 'var(--app-border)',
                  color: active ? 'var(--app-accent)' : 'var(--app-text-muted)',
                }}
                onClick={() => {
                  setActiveShortcut(preset.label)
                  onFromChange(preset.from)
                  onToChange(preset.to)
                }}
              >
                {preset.label}
              </button>
            )
          })}
        </div>

        <div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
            <DateField
              id="date-range-from"
              value={from}
              onChange={(value) => {
                setActiveShortcut(null)
                onFromChange(value)
              }}
            />
            <span
              className="flex h-7 w-6 items-center justify-center"
              style={{ color: 'var(--app-text-subtle)' }}
              aria-hidden
            >
              <ArrowRight size={14} />
            </span>
            <DateField
              id="date-range-to"
              value={to}
              onChange={(value) => {
                setActiveShortcut(null)
                onToChange(value)
              }}
            />
          </div>
          {invalid ? (
            <p className="mt-2 text-xs leading-5" style={{ color: 'var(--app-negative)' }}>
              Start date must be on or before end date.
            </p>
          ) : null}
        </div>
      </div>

      <div
        className="flex items-center justify-between gap-2 px-4 py-3"
        style={{ borderTop: '1px solid var(--app-border)' }}
      >
        <button
          type="button"
          className="app-secondary-button h-9 px-3 text-sm"
          disabled={!from && !to}
          onClick={() => {
            setActiveShortcut(null)
            onReset()
          }}
        >
          <RotateCcw size={13} aria-hidden />
          Reset
        </button>
        <button
          type="button"
          className="app-primary-button h-9 px-4 text-sm"
          disabled={invalid || !changed}
          onClick={onApply}
        >
          Apply
        </button>
      </div>
    </div>
  )
}
