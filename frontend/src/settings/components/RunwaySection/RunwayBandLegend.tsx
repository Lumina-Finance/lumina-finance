import {
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react'
import {
  DEFAULT_RUNWAY_THRESHOLDS,
  RUNWAY_BAND_STYLE,
} from '@/utils/runway'
import { clampThreshold } from './runwayThresholdSliderUtils'

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

/**
 * Renders a runway band label with an optional editable threshold input
 */
export function RunwayBandLegend(props: RunwayBandLegendProps) {
  const { band, value } = props
  const style = RUNWAY_BAND_STYLE[band]
  const hasInput = props.onInputChange !== undefined
  const inputValue = hasInput ? props.inputValue : undefined
  const formattedInputValue = formatThresholdInputValue(inputValue)
  const [inputDraft, setInputDraft] = useState<string | null>(null)
  const inputText = inputDraft ?? formattedInputValue

  /**
   * Allows partial decimal input while still updating valid threshold values immediately
   */
  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (!props.onInputChange) return
    const nextText = event.currentTarget.value
    setInputDraft(nextText)
    if (nextText.trim() === '' || nextText === '.') return

    const nextValue = Number(nextText)
    if (Number.isFinite(nextValue)) props.onInputChange(nextValue)
  }

  /**
   * Restores invalid or out-of-range text to a valid threshold when editing ends
   */
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

/**
 * Blocks characters that would make threshold text impossible to parse as a decimal month count
 */
function handleThresholdInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
  if (event.metaKey || event.ctrlKey) return
  if (event.key.length !== 1) return

  const input = event.currentTarget
  const selectionStart = input.selectionStart ?? input.value.length
  const selectionEnd = input.selectionEnd ?? input.value.length
  const nextValue = `${input.value.slice(0, selectionStart)}${event.key}${input.value.slice(selectionEnd)}`

  if (!isThresholdInputText(nextValue)) event.preventDefault()
}

/**
 * Blocks pasted text that would bypass the same decimal-only threshold constraint
 */
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
