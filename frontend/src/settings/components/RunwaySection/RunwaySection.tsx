import { Archive, Check } from 'lucide-react'
import {
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import type { AccountsOverview } from '@/api/accounts'
import MarqueeText from '@/components/MarqueeText'
import {
  DEFAULT_RUNWAY_THRESHOLDS,
  RUNWAY_BAND_STYLE,
  RUNWAY_THRESHOLD_MAX_MONTHS,
  RUNWAY_THRESHOLD_MIN_MONTHS,
  RUNWAY_THRESHOLD_MIN_SEPARATION_MONTHS,
  RUNWAY_THRESHOLD_STEP_MONTHS,
  normalizeRunwayThresholds,
  type RunwayThresholds,
} from '@/utils/runway'
import { formatCurrency } from '@/utils/formatCurrency'
import SectionHeader from '@/settings/components/SectionHeader'
import SettingsCard from '@/settings/components/SettingsCard'

/* ── Runway ── */

const RUNWAY_TRACK_LABEL_MIN_PCT = 12

interface RunwaySectionProps {
  loading: boolean
  accounts: AccountsOverview[]
  archivedAccounts: AccountsOverview[]
  selection: Set<string>
  onToggle: (id: string) => void
  thresholds: RunwayThresholds
  onThresholdChange: (field: keyof RunwayThresholds, value: number) => void
  actions: ReactNode
}

export default function RunwaySection({
  loading,
  accounts,
  archivedAccounts,
  selection,
  onToggle,
  thresholds,
  onThresholdChange,
  actions,
}: RunwaySectionProps) {
  return (
    <section id="runway" className="scroll-mt-8">
      <SectionHeader
        title="Runway"
        description={
          <>
            <p>
              Pick which accounts should count toward calculating your runway — how long the total balance in the selected accounts will last if your average monthly net expenses don't change. The average uses up to the last 12 completed months with recorded expenses; the current partial month and months with no net expense data are excluded. Only open asset accounts are eligible; liabilities like credit cards or loans can't be counted.
            </p>
            <p>
              For example, if your selected accounts hold $30,000 and you've averaged $5,000 a month in net expenses, that's a 6-month runway.
            </p>
          </>
        }
      />

      <SettingsCard>
        <div className="space-y-6">
          <div className="space-y-6">
            <div className="space-y-1">
              <h3 className="text-base font-semibold">Status thresholds</h3>
              <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                Month cutoffs for the runway status pill.
              </p>
            </div>

            <RunwayThresholdSlider thresholds={thresholds} onThresholdChange={onThresholdChange} />
          </div>

          <div className="space-y-4 border-t pt-6" style={{ borderColor: 'var(--app-border)' }}>
            <div className="space-y-1">
              <h3 className="text-base font-semibold">Accounts</h3>
              <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                Choose which accounts count toward your available runway balance.{' '}
                <strong style={{ color: 'var(--app-text)' }}>
                  Only open asset accounts are eligible and shown here.
                </strong>
              </p>
            </div>

            {loading ? null : accounts.length === 0 ? (
              <p className="py-3 text-center italic text-sm" style={{ color: 'var(--app-text-subtle)' }}>
                No eligible accounts yet. Add an asset account to configure runway.
              </p>
            ) : (
              <div className="space-y-4">
                <div className="grid gap-2 min-[1500px]:grid-cols-2">
                  {accounts.map((account) => (
                    <RunwayAccountTile
                      key={account.id}
                      account={account}
                      selected={selection.has(account.id)}
                      onToggle={() => onToggle(account.id)}
                    />
                  ))}
                </div>
                <p className="text-xs" style={{ color: 'var(--app-text-subtle)' }}>
                  {selection.size} of {accounts.length} selected
                </p>
              </div>
            )}

          </div>

          {!loading && archivedAccounts.length > 0 && (
            <div className="space-y-4 border-t pt-6" style={{ borderColor: 'var(--app-border)' }}>
              <div className="space-y-1">
                <h3 className="text-base font-semibold">Archived selections</h3>
                <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                  These accounts were selected before being archived. Archived accounts do not count toward runway and cannot be changed here. Unarchive an account to make it eligible again.
                </p>
              </div>
              <div className="grid gap-2 min-[1500px]:grid-cols-2">
                {archivedAccounts.map((account) => (
                  <ArchivedRunwayAccountTile key={account.id} account={account} />
                ))}
              </div>
            </div>
          )}

          {actions}
        </div>
      </SettingsCard>
    </section>
  )
}

function ArchivedRunwayAccountTile({ account }: { account: AccountsOverview }) {
  const institutionName = account.institution?.name ?? 'Cash'
  return (
    <div
      className="app-marquee-trigger flex w-full min-w-0 items-center gap-3 overflow-hidden rounded-xl px-3 py-2.5 text-left"
      style={{
        background: 'var(--app-input-bg)',
        border: '1px solid var(--app-input-border)',
        opacity: 0.6,
      }}
    >
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
        style={{
          background: 'transparent',
          border: '1px solid var(--app-border-strong)',
          color: 'var(--app-text-muted)',
        }}
      >
        <Archive size={12} aria-hidden />
      </span>
      <span className="min-w-0 flex-1 overflow-hidden">
        <MarqueeText active className="font-medium">{account.name}</MarqueeText>
        <span className="block text-xs truncate" style={{ color: 'var(--app-text-muted)' }}>
          {institutionName} · Archived
        </span>
      </span>
      <span className="shrink-0 text-right tabular-nums">
        <span className="block font-financial text-sm font-medium" style={{ color: 'var(--app-text-muted)' }}>
          {formatCurrency(account.current_balance, account.currency)}
        </span>
      </span>
    </div>
  )
}

function RunwayAccountTile({
  account,
  selected,
  onToggle,
}: {
  account: AccountsOverview
  selected: boolean
  onToggle: () => void
}) {
  const institutionName = account.institution?.name ?? 'Cash'
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      onClick={onToggle}
      className="app-marquee-trigger flex w-full min-w-0 items-center gap-3 overflow-hidden rounded-xl px-3 py-2.5 text-left transition-colors duration-200"
      style={{
        background: selected ? 'var(--app-accent-soft)' : 'var(--app-input-bg)',
        border: `1px solid ${selected ? 'var(--app-accent-border)' : 'var(--app-input-border)'}`,
      }}
    >
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
        style={{
          background: selected ? 'var(--app-accent)' : 'transparent',
          border: `1px solid ${selected ? 'var(--app-accent)' : 'var(--app-border-strong)'}`,
          color: '#1C1510',
        }}
      >
        {selected && <Check size={13} strokeWidth={3} aria-hidden />}
      </span>
      <span className="min-w-0 flex-1 overflow-hidden">
        <MarqueeText active className="font-medium">{account.name}</MarqueeText>
        <span className="block text-xs truncate" style={{ color: 'var(--app-text-muted)' }}>
          {institutionName}
        </span>
      </span>
      <span className="shrink-0 text-right tabular-nums">
        <span
          className="block font-financial text-sm font-medium"
          style={{
            color:
              account.current_balance > 0
                ? 'var(--app-positive)'
                : account.current_balance < 0
                  ? 'var(--app-negative)'
                  : 'var(--app-text)',
          }}
        >
          {formatCurrency(account.current_balance, account.currency)}
        </span>
        {account.credit_limit !== null && (
          <span
            className="block font-financial text-xs"
            style={{ color: 'var(--app-text-muted)' }}
          >
            {formatCurrency(account.credit_limit + account.current_balance, account.currency)} avail.
          </span>
        )}
      </span>
    </button>
  )
}

function RunwayThresholdSlider({
  thresholds,
  onThresholdChange,
}: {
  thresholds: RunwayThresholds
  onThresholdChange: (field: keyof RunwayThresholds, value: number) => void
}) {
  const railRef = useRef<HTMLDivElement>(null)
  const [draggingField, setDraggingField] = useState<keyof RunwayThresholds | null>(null)
  const [dragPreview, setDragPreview] = useState<{ field: keyof RunwayThresholds; value: number } | null>(null)
  const safeThresholds = normalizeRunwayThresholds(thresholds)
  const riskyMax = safeThresholds.healthyAtMonths - RUNWAY_THRESHOLD_MIN_SEPARATION_MONTHS
  const healthyMin = safeThresholds.riskyBelowMonths + RUNWAY_THRESHOLD_MIN_SEPARATION_MONTHS
  const displayRiskyMonths = dragPreview?.field === 'riskyBelowMonths'
    ? dragPreview.value
    : safeThresholds.riskyBelowMonths
  const displayHealthyMonths = dragPreview?.field === 'healthyAtMonths'
    ? dragPreview.value
    : safeThresholds.healthyAtMonths
  const riskyPct = thresholdPct(displayRiskyMonths)
  const healthyPct = thresholdPct(displayHealthyMonths)
  const riskySegmentPct = riskyPct
  const lowPct = Math.max(healthyPct - riskyPct, 0)
  const lowMidPct = riskyPct + lowPct / 2
  const healthySegmentPct = Math.max(100 - healthyPct, 0)
  const healthyMidPct = healthyPct + healthySegmentPct / 2
  const trackGradient = getRunwayThresholdGradient(riskyPct, healthyPct)
  const updateRiskyThreshold = (value: number) => {
    onThresholdChange(
      'riskyBelowMonths',
      clampThreshold(value, RUNWAY_THRESHOLD_MIN_MONTHS, riskyMax),
    )
  }
  const updateHealthyThreshold = (value: number) => {
    onThresholdChange(
      'healthyAtMonths',
      clampThreshold(value, healthyMin, RUNWAY_THRESHOLD_MAX_MONTHS),
    )
  }
  const updateThreshold = (field: keyof RunwayThresholds, value: number) => {
    if (field === 'riskyBelowMonths') updateRiskyThreshold(value)
    else updateHealthyThreshold(value)
  }
  const clampThresholdForField = (field: keyof RunwayThresholds, value: number) => {
    if (field === 'riskyBelowMonths') return clampThreshold(value, RUNWAY_THRESHOLD_MIN_MONTHS, riskyMax)
    return clampThreshold(value, healthyMin, RUNWAY_THRESHOLD_MAX_MONTHS)
  }
  const updateThresholdFromPointer = (field: keyof RunwayThresholds, clientX: number) => {
    const nextValue = thresholdFromRailPoint(clientX, railRef.current)
    if (nextValue === null) return

    const clampedValue = clampThresholdForField(field, nextValue)
    setDragPreview({ field, value: clampedValue })
    updateThreshold(field, roundThresholdValue(clampedValue))
  }
  const startDragging = (
    field: keyof RunwayThresholds,
    event: PointerEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDraggingField(field)
    updateThresholdFromPointer(field, event.clientX)
  }
  const moveDragging = (
    field: keyof RunwayThresholds,
    event: PointerEvent<HTMLButtonElement>,
  ) => {
    if (draggingField !== field) return
    updateThresholdFromPointer(field, event.clientX)
  }
  const stopDragging = (event: PointerEvent<HTMLButtonElement>) => {
    if (draggingField !== null) updateThresholdFromPointer(draggingField, event.clientX)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setDraggingField(null)
    setDragPreview(null)
  }
  const handleThresholdKeyDown = (
    field: keyof RunwayThresholds,
    event: KeyboardEvent<HTMLButtonElement>,
  ) => {
    const currentValue = field === 'riskyBelowMonths'
      ? safeThresholds.riskyBelowMonths
      : safeThresholds.healthyAtMonths
    const lowerBound = field === 'riskyBelowMonths' ? RUNWAY_THRESHOLD_MIN_MONTHS : healthyMin
    const upperBound = field === 'riskyBelowMonths' ? riskyMax : RUNWAY_THRESHOLD_MAX_MONTHS
    const keyValue: Record<string, number> = {
      ArrowLeft: currentValue - RUNWAY_THRESHOLD_STEP_MONTHS,
      ArrowDown: currentValue - RUNWAY_THRESHOLD_STEP_MONTHS,
      ArrowRight: currentValue + RUNWAY_THRESHOLD_STEP_MONTHS,
      ArrowUp: currentValue + RUNWAY_THRESHOLD_STEP_MONTHS,
      Home: lowerBound,
      End: upperBound,
    }
    const nextValue = keyValue[event.key]
    if (nextValue === undefined) return

    event.preventDefault()
    updateThreshold(field, nextValue)
  }

  return (
    <div className="space-y-4">
      <div className="relative h-12 w-full">
        <div className="relative h-full">
          <ThresholdHandle
            band="risky"
            value={`< ${formatThresholdMonths(safeThresholds.riskyBelowMonths)}`}
            pct={riskyPct}
            ariaLabel="Risky threshold"
            currentValue={safeThresholds.riskyBelowMonths}
            minValue={RUNWAY_THRESHOLD_MIN_MONTHS}
            maxValue={riskyMax}
            isDragging={draggingField === 'riskyBelowMonths'}
            onPointerDown={(event) => startDragging('riskyBelowMonths', event)}
            onPointerMove={(event) => moveDragging('riskyBelowMonths', event)}
            onPointerUp={stopDragging}
            onPointerCancel={stopDragging}
            onKeyDown={(event) => handleThresholdKeyDown('riskyBelowMonths', event)}
          />
          <ThresholdHandle
            band="healthy"
            value={`>= ${formatThresholdMonths(safeThresholds.healthyAtMonths)}`}
            pct={healthyPct}
            ariaLabel="Healthy threshold"
            currentValue={safeThresholds.healthyAtMonths}
            minValue={healthyMin}
            maxValue={RUNWAY_THRESHOLD_MAX_MONTHS}
            isDragging={draggingField === 'healthyAtMonths'}
            onPointerDown={(event) => startDragging('healthyAtMonths', event)}
            onPointerMove={(event) => moveDragging('healthyAtMonths', event)}
            onPointerUp={stopDragging}
            onPointerCancel={stopDragging}
            onKeyDown={(event) => handleThresholdKeyDown('healthyAtMonths', event)}
          />

          <div
            ref={railRef}
            className="absolute inset-x-0 top-4 h-4 overflow-hidden rounded-full"
            style={{
              background: trackGradient,
              border: '1px solid var(--app-input-border)',
            }}
          >
            <RunwayTrackLabel
              band="risky"
              pct={riskySegmentPct / 2}
              visible={riskySegmentPct >= RUNWAY_TRACK_LABEL_MIN_PCT}
            />
            <RunwayTrackLabel
              band="low"
              pct={lowMidPct}
              visible={lowPct >= RUNWAY_TRACK_LABEL_MIN_PCT}
            />
            <RunwayTrackLabel
              band="healthy"
              pct={healthyMidPct}
              visible={healthySegmentPct >= RUNWAY_TRACK_LABEL_MIN_PCT}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-2 min-[1500px]:grid-cols-3">
        <RunwayBandLegend
          band="risky"
          value={`< ${formatThresholdMonths(safeThresholds.riskyBelowMonths)}`}
          inputPrefix="<"
          inputLabel="Risky below"
          inputValue={safeThresholds.riskyBelowMonths}
          inputMin={RUNWAY_THRESHOLD_MIN_MONTHS}
          inputMax={riskyMax}
          onInputChange={updateRiskyThreshold}
        />
        <RunwayBandLegend
          band="low"
          value={`${formatThresholdMonths(safeThresholds.riskyBelowMonths)} - ${formatThresholdMonths(safeThresholds.healthyAtMonths)}`}
        />
        <RunwayBandLegend
          band="healthy"
          value={`>= ${formatThresholdMonths(safeThresholds.healthyAtMonths)}`}
          inputPrefix=">="
          inputLabel="Healthy at"
          inputValue={safeThresholds.healthyAtMonths}
          inputMin={healthyMin}
          inputMax={RUNWAY_THRESHOLD_MAX_MONTHS}
          onInputChange={updateHealthyThreshold}
        />
      </div>
    </div>
  )
}

function ThresholdHandle({
  band,
  value,
  pct,
  ariaLabel,
  currentValue,
  minValue,
  maxValue,
  isDragging,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onKeyDown,
}: {
  band: keyof typeof RUNWAY_BAND_STYLE
  value: string
  pct: number
  ariaLabel: string
  currentValue: number
  minValue: number
  maxValue: number
  isDragging: boolean
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void
  onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void
  onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => void
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
}) {
  const style = RUNWAY_BAND_STYLE[band]

  return (
    <div
      className={`absolute inset-y-0 z-20 -translate-x-1/2 ${isDragging ? '' : 'transition-[left] duration-150 ease-out'}`}
      style={{ left: `${pct}%` }}
    >
      <button
        type="button"
        role="slider"
        aria-label={ariaLabel}
        aria-valuemin={minValue}
        aria-valuemax={maxValue}
        aria-valuenow={currentValue}
        aria-valuetext={value}
        className={`absolute left-1/2 top-6 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${isDragging ? 'scale-110 cursor-grabbing' : 'cursor-grab'}`}
        style={{
          background: 'var(--app-bg)',
          borderColor: style.fg,
          boxShadow: '0 0 0 3px var(--app-surface-soft), var(--app-shadow-soft)',
          color: style.fg,
          '--tw-ring-color': style.fg,
          '--tw-ring-offset-color': 'var(--app-bg)',
        } as CSSProperties}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onKeyDown={onKeyDown}
      />
    </div>
  )
}

function RunwayTrackLabel({
  band,
  pct,
  visible,
}: {
  band: keyof typeof RUNWAY_BAND_STYLE
  pct: number
  visible: boolean
}) {
  if (!visible) return null

  const style = RUNWAY_BAND_STYLE[band]

  return (
    <span
      className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-[0.65rem] font-semibold leading-none"
      style={{ left: `${pct}%`, color: style.fg }}
    >
      {style.label}
    </span>
  )
}

type RunwayBandLegendProps = {
  band: keyof typeof RUNWAY_BAND_STYLE
  value: string
} & (
  {
    inputPrefix: string
    inputLabel: string
    inputValue: number
    inputMin: number
    inputMax: number
    onInputChange: (value: number) => void
  } | {
    inputPrefix?: never
    inputLabel?: never
    inputValue?: never
    inputMin?: never
    inputMax?: never
    onInputChange?: never
  }
)

function RunwayBandLegend(props: RunwayBandLegendProps) {
  const { band, value } = props
  const style = RUNWAY_BAND_STYLE[band]
  const hasInput = props.onInputChange !== undefined
  const inputValue = hasInput ? props.inputValue : undefined
  const formattedInputValue = formatThresholdInputValue(inputValue)
  const [inputDraft, setInputDraft] = useState<string | null>(null)
  const inputText = inputDraft ?? formattedInputValue

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (!props.onInputChange) return
    const nextText = event.currentTarget.value
    setInputDraft(nextText)
    if (nextText.trim() === '' || nextText === '.') return

    const nextValue = Number(nextText)
    if (Number.isFinite(nextValue)) props.onInputChange(nextValue)
  }
  const handleInputBlur = () => {
    if (!props.onInputChange) return

    const trimmedText = inputText.trim()
    const nextValue = Number(trimmedText)
    const invalidValue = trimmedText === '' || trimmedText === '.' || !Number.isFinite(nextValue)
      || nextValue < props.inputMin || nextValue > props.inputMax
    const fallbackValue = clampThreshold(
      defaultThresholdInputValue(band),
      props.inputMin,
      props.inputMax,
    )
    const committedValue = invalidValue ? fallbackValue : nextValue

    props.onInputChange(committedValue)
    setInputDraft(null)
  }

  return (
    <div
      className="flex min-w-0 items-center justify-between gap-3 rounded-lg px-3 py-2.5"
      style={{
        background: 'var(--app-input-bg)',
        border: '1px solid var(--app-input-border)',
      }}
    >
      <span
        className="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold"
        style={{ background: style.bg, color: style.fg }}
      >
        {style.label}
      </span>
      {props.onInputChange ? (
        <span className="flex min-w-0 items-center gap-2">
          <span className="font-financial text-sm" style={{ color: 'var(--app-text-muted)' }}>
            {props.inputPrefix}
          </span>
          <label className="relative block w-[6.75rem] shrink-0">
            <span className="sr-only">{props.inputLabel}</span>
            <input
              className="app-input app-runway-threshold-input h-8 rounded-md px-2 pr-10 font-financial text-sm"
              type="text"
              inputMode="decimal"
              value={inputText}
              onChange={handleInputChange}
              onFocus={() => setInputDraft(formattedInputValue)}
              onBlur={handleInputBlur}
              onKeyDown={handleThresholdInputKeyDown}
              onPaste={handleThresholdInputPaste}
            />
            <span
              className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[0.6875rem]"
              style={{ color: 'var(--app-text-muted)' }}
            >
              mths
            </span>
          </label>
        </span>
      ) : (
        <span className="min-w-0 truncate font-financial text-sm" style={{ color: 'var(--app-text-muted)' }}>
          {value}
        </span>
      )}
    </div>
  )
}

function handleThresholdInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
  if (event.metaKey || event.ctrlKey) return
  if (event.key.length !== 1) return

  const input = event.currentTarget
  const selectionStart = input.selectionStart ?? input.value.length
  const selectionEnd = input.selectionEnd ?? input.value.length
  const nextValue = `${input.value.slice(0, selectionStart)}${event.key}${input.value.slice(selectionEnd)}`

  if (!isThresholdInputText(nextValue)) event.preventDefault()
}

function handleThresholdInputPaste(event: ClipboardEvent<HTMLInputElement>) {
  const input = event.currentTarget
  const pastedText = event.clipboardData.getData('text').trim()
  const selectionStart = input.selectionStart ?? input.value.length
  const selectionEnd = input.selectionEnd ?? input.value.length
  const nextValue = `${input.value.slice(0, selectionStart)}${pastedText}${input.value.slice(selectionEnd)}`

  if (!isThresholdInputText(nextValue)) event.preventDefault()
}

function isThresholdInputText(value: string) {
  return /^\d*\.?\d*$/.test(value)
}

function defaultThresholdInputValue(band: keyof typeof RUNWAY_BAND_STYLE) {
  return band === 'healthy'
    ? DEFAULT_RUNWAY_THRESHOLDS.healthyAtMonths
    : DEFAULT_RUNWAY_THRESHOLDS.riskyBelowMonths
}

function formatThresholdInputValue(value: number | undefined) {
  if (value === undefined) return ''
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function formatThresholdMonths(value: number) {
  const label = Number.isInteger(value) ? String(value) : value.toFixed(1)
  return `${label} ${value === 1 ? 'mth' : 'mths'}`
}

function thresholdPct(value: number) {
  const range = RUNWAY_THRESHOLD_MAX_MONTHS - RUNWAY_THRESHOLD_MIN_MONTHS
  return ((value - RUNWAY_THRESHOLD_MIN_MONTHS) / range) * 100
}

function clampThreshold(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function thresholdFromRailPoint(clientX: number, rail: HTMLDivElement | null) {
  if (!rail) return null
  const { left, width } = rail.getBoundingClientRect()
  if (width <= 0) return null

  const pct = clampThreshold((clientX - left) / width, 0, 1)
  const range = RUNWAY_THRESHOLD_MAX_MONTHS - RUNWAY_THRESHOLD_MIN_MONTHS
  return RUNWAY_THRESHOLD_MIN_MONTHS + pct * range
}

function roundThresholdValue(value: number) {
  return Math.round(value / RUNWAY_THRESHOLD_STEP_MONTHS) * RUNWAY_THRESHOLD_STEP_MONTHS
}

function getRunwayThresholdGradient(riskyPct: number, healthyPct: number) {
  const blendPct = thresholdPct(1)
  const riskyBlendStart = Math.max(0, riskyPct - blendPct)
  const riskyBlendEnd = Math.min(healthyPct, riskyPct + blendPct)
  const healthyBlendStart = Math.max(riskyPct, healthyPct - blendPct)
  const healthyBlendEnd = Math.min(100, healthyPct + blendPct)
  const riskyFill = runwayTrackColor('risky')
  const lowFill = runwayTrackColor('low')
  const healthyFill = runwayTrackColor('healthy')

  return `linear-gradient(90deg,
    ${riskyFill} 0%,
    ${riskyFill} ${riskyBlendStart}%,
    ${lowFill} ${riskyBlendEnd}%,
    ${lowFill} ${healthyBlendStart}%,
    ${healthyFill} ${healthyBlendEnd}%,
    ${healthyFill} 100%)`
}

function runwayTrackColor(band: keyof typeof RUNWAY_BAND_STYLE) {
  return `color-mix(in srgb, ${RUNWAY_BAND_STYLE[band].fg} 38%, var(--app-input-bg))`
}
