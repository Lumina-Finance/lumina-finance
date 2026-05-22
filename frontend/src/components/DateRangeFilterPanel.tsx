import { useLayoutEffect, useRef, useState } from 'react'
import { CalendarDays, RotateCcw } from 'lucide-react'

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

const MOBILE_DATE_LABEL_MAX_FONT_SIZE = 15
const MOBILE_DATE_LABEL_MIN_FONT_SIZE = 10

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
  ]
}

function DateField({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  const label = id === 'date-range-from' ? 'Start date' : 'End date'
  const displayValue = value || 'yyyy-mm-dd'
  const visibleTextRef = useRef<HTMLSpanElement>(null)
  const measuredTextRef = useRef<HTMLSpanElement>(null)
  const [mobileLabelFontSize, setMobileLabelFontSize] = useState(MOBILE_DATE_LABEL_MAX_FONT_SIZE)

  useLayoutEffect(() => {
    const visibleText = visibleTextRef.current
    const measuredText = measuredTextRef.current
    if (!visibleText || !measuredText) return undefined

    const updateFontSize = () => {
      const availableWidth = visibleText.getBoundingClientRect().width
      const measuredWidth = measuredText.scrollWidth
      if (availableWidth <= 0 || measuredWidth <= 0) return

      const nextSize = Math.max(
        MOBILE_DATE_LABEL_MIN_FONT_SIZE,
        Math.min(MOBILE_DATE_LABEL_MAX_FONT_SIZE, MOBILE_DATE_LABEL_MAX_FONT_SIZE * (availableWidth / measuredWidth)),
      )
      setMobileLabelFontSize((current) => (Math.abs(current - nextSize) > 0.1 ? nextSize : current))
    }

    updateFontSize()
    const resizeObserver = new ResizeObserver(updateFontSize)
    resizeObserver.observe(visibleText)
    return () => resizeObserver.disconnect()
  }, [displayValue])

  return (
    <>
      <div className="relative min-w-0 min-[750px]:hidden">
        <div className="app-input app-date-input-balanced pointer-events-none relative flex items-center gap-2">
          <span
            ref={visibleTextRef}
            className="min-w-0 flex-1 whitespace-nowrap"
            style={{
              color: value ? 'var(--app-text)' : 'var(--app-text-subtle)',
              fontSize: `${mobileLabelFontSize}px`,
            }}
          >
            {displayValue}
          </span>
          <span
            ref={measuredTextRef}
            className="invisible absolute whitespace-nowrap"
            style={{ fontSize: `${MOBILE_DATE_LABEL_MAX_FONT_SIZE}px` }}
            aria-hidden
          >
            {displayValue}
          </span>
          <CalendarDays size={15} className="shrink-0" style={{ color: 'var(--app-text-subtle)' }} aria-hidden />
        </div>
        <input
          id={`${id}-mobile`}
          type="date"
          aria-label={label}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      <input
        id={`${id}-desktop`}
        type="date"
        aria-label={label}
        className="app-input app-date-input-balanced hidden min-w-0 min-[750px]:block"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </>
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
        <div className="grid grid-cols-4 gap-1">
          {presets.map((preset) => {
            const active = activeShortcut === preset.label
            return (
              <button
                key={preset.label}
                type="button"
                className={`h-8 rounded-md border px-1.5 text-[0.8125rem] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent-soft)] ${
                  active
                    ? 'bg-[var(--app-accent-soft)] hover:bg-[var(--app-accent-soft)]'
                    : 'bg-[var(--app-input-bg)] hover:bg-[var(--app-surface-soft)]'
                }`}
                style={{
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
            <span className="text-xs font-semibold uppercase" style={{ color: 'var(--app-text-subtle)' }}>
              to
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
