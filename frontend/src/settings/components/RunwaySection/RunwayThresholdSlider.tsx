import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import {
  RUNWAY_BAND_STYLE,
  RUNWAY_THRESHOLD_MAX_MONTHS,
  RUNWAY_THRESHOLD_MIN_MONTHS,
  RUNWAY_THRESHOLD_MIN_SEPARATION_MONTHS,
  RUNWAY_THRESHOLD_STEP_MONTHS,
  normalizeRunwayThresholds,
  type RunwayThresholds,
} from '@/utils/runway'
import { RunwayBandLegend } from './RunwayBandLegend'
import {
  clampThreshold,
  formatThresholdMonths,
  getRunwayThresholdGradient,
  roundThresholdValue,
  thresholdFromRailPoint,
  thresholdPct,
} from './runwayThresholdSliderUtils'

const RUNWAY_TRACK_LABEL_MIN_PCT = 12

interface RunwayThresholdSliderProps {
  thresholds: RunwayThresholds
  onThresholdChange: (field: keyof RunwayThresholds, value: number) => void
}

interface ThresholdHandleProps {
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
}

interface RunwayTrackLabelProps {
  band: keyof typeof RUNWAY_BAND_STYLE
  pct: number
  visible: boolean
}

/**
 * Renders the runway threshold slider with pointer, keyboard, and text-input editing
 */
export function RunwayThresholdSlider({
  thresholds,
  onThresholdChange,
}: RunwayThresholdSliderProps) {
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

  /**
   * Keeps the risky threshold below the healthy threshold by the configured separation
   */
  const updateRiskyThreshold = (value: number) => {
    onThresholdChange(
      'riskyBelowMonths',
      clampThreshold(value, RUNWAY_THRESHOLD_MIN_MONTHS, riskyMax),
    )
  }

  /**
   * Keeps the healthy threshold above the risky threshold by the configured separation
   */
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

  /**
   * Applies the active opposing threshold as a dynamic boundary for drag updates
   */
  const clampThresholdForField = (field: keyof RunwayThresholds, value: number) => {
    if (field === 'riskyBelowMonths') return clampThreshold(value, RUNWAY_THRESHOLD_MIN_MONTHS, riskyMax)

    return clampThreshold(value, healthyMin, RUNWAY_THRESHOLD_MAX_MONTHS)
  }

  /**
   * Converts pointer movement into a rounded threshold value while keeping drag preview smooth
   */
  const updateThresholdFromPointer = (field: keyof RunwayThresholds, clientX: number) => {
    const nextValue = thresholdFromRailPoint(clientX, railRef.current)
    if (nextValue === null) return

    const clampedValue = clampThresholdForField(field, nextValue)
    setDragPreview({ field, value: clampedValue })
    updateThreshold(field, roundThresholdValue(clampedValue))
  }

  /**
   * Captures pointer movement so dragging remains stable when the cursor leaves the handle
   */
  const startDragging = (
    field: keyof RunwayThresholds,
    event: PointerEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDraggingField(field)
    updateThresholdFromPointer(field, event.clientX)
  }

  /**
   * Ignores pointer movement from the inactive handle during a drag interaction
   */
  const moveDragging = (
    field: keyof RunwayThresholds,
    event: PointerEvent<HTMLButtonElement>,
  ) => {
    if (draggingField !== field) return
    updateThresholdFromPointer(field, event.clientX)
  }

  /**
   * Commits the final drag position before clearing pointer capture and preview state
   */
  const stopDragging = (event: PointerEvent<HTMLButtonElement>) => {
    if (draggingField !== null) updateThresholdFromPointer(draggingField, event.clientX)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setDraggingField(null)
    setDragPreview(null)
  }

  /**
   * Supports keyboard slider controls using the same threshold boundaries as pointer input
   */
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

/**
 * Renders a draggable threshold handle with slider accessibility metadata
 */
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
}: ThresholdHandleProps) {
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

/**
 * Keeps track labels hidden when a segment is too narrow to read cleanly
 */
function RunwayTrackLabel({ band, pct, visible }: RunwayTrackLabelProps) {
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
