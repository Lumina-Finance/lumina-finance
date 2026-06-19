import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, useReducedMotion } from 'motion/react'
import { Calendar, ChevronDown } from 'lucide-react'
import type { SavedInsightsRange } from '@/api/insights'
import { joinClassNames } from '@/utils/classNames'
import type { InsightsRangePreset, SavedInsightsRangeQualifier, SavedInsightsRangeUnit } from '../types/range'
import { formatResolvedRangeLabel, getRelativeRangeLabel } from '../utils/range'
import { RelativeRangeBuilder } from './RelativeRangeBuilder'
import { SavedRanges } from './SavedRanges'

// Chrome around the measured text column in the collapsed pill: horizontal padding, the calendar
// icon and its gap, the trailing chevron and its gap, plus a couple of pixels so sub-pixel
// rounding never truncates the wider line. Added to the measured text width to size the pill
const COLLAPSED_HEAD_CHROME = 83

// Open width of the desktop sidebar pill (21rem), the start point is the measured label width
const OPEN_DESKTOP_WIDTH = 336

// Lightly damped spring for a gentle settle with little overshoot, matching the toned-down feel
const glassSpring = { type: 'spring', stiffness: 420, damping: 34, mass: 0.9 } as const

// Fallback collapsed width used for the first frame before the label is measured
const COLLAPSED_WIDTH_FALLBACK = 180

const INSIGHTS_RANGE_OPTIONS: { value: InsightsRangePreset; code: string; label: string }[] = [
  { value: 'THIS_MONTH', code: 'MTD', label: 'This month' },
  { value: 'LAST_MONTH', code: 'LM', label: 'Last month' },
  { value: 'LAST_30_DAYS', code: '30D', label: 'Last 30 days' },
  { value: 'LAST_90_DAYS', code: '90D', label: 'Last 90 days' },
  { value: 'THIS_YEAR', code: 'YTD', label: 'This year' },
  { value: 'CUSTOM', code: 'Custom', label: 'Custom' },
]

type InsightsFloatingRangeControlProps = {
  preset: InsightsRangePreset
  relativeAmount: number
  relativeUnit: SavedInsightsRangeUnit
  relativeQualifier: SavedInsightsRangeQualifier
  resolvedFrom: string
  resolvedTo: string
  // Name of the applied saved range, shown as the pill label until the window is changed
  appliedSavedRangeName: string | null
  savedRanges: SavedInsightsRange[]
  onPresetChange: (value: InsightsRangePreset) => void
  onRelativeAmountChange: (value: number) => void
  onRelativeUnitChange: (value: SavedInsightsRangeUnit) => void
  onRelativeQualifierChange: (value: SavedInsightsRangeQualifier) => void
  onSaveCurrentRange: (name: string) => Promise<void>
  onApplySavedRange: (range: SavedInsightsRange) => void
  onDeleteSavedRange: (rangeId: string) => void
}

type GlassRangeSelectorProps = InsightsFloatingRangeControlProps & {
  // The mobile control spans the full width instead of hugging its content like the sidebar pill
  fullWidth: boolean
  // The bottom-floating mobile control grows upward so its panel opens above the pill
  growUp: boolean
}

/**
 * Renders the collapsing liquid-glass range pill that blooms open into the preset row, the
 * relative-window builder, and saved ranges
 */
function GlassRangeSelector({
  preset,
  relativeAmount,
  relativeUnit,
  relativeQualifier,
  resolvedFrom,
  resolvedTo,
  appliedSavedRangeName,
  savedRanges,
  onPresetChange,
  onRelativeAmountChange,
  onRelativeUnitChange,
  onRelativeQualifierChange,
  onSaveCurrentRange,
  onApplySavedRange,
  onDeleteSavedRange,
  fullWidth,
  growUp,
}: GlassRangeSelectorProps) {
  const [open, setOpen] = useState(false)
  const [collapsedWidth, setCollapsedWidth] = useState(COLLAPSED_WIDTH_FALLBACK)
  const containerRef = useRef<HTMLDivElement>(null)
  const shouldReduceMotion = useReducedMotion()
  const isCustom = preset === 'CUSTOM'
  const currentLabel = appliedSavedRangeName
    ?? (isCustom
      ? getRelativeRangeLabel(relativeAmount, relativeUnit, relativeQualifier)
      : INSIGHTS_RANGE_OPTIONS.find((option) => option.value === preset)?.label ?? '')
  const rangeLabel = formatResolvedRangeLabel(resolvedFrom, resolvedTo)
  const transition = shouldReduceMotion ? { duration: 0 } : glassSpring

  // Pins the collapsed desktop pill to its text width, since fit-content would otherwise include
  // the hidden panel's width. Remeasured on label or date change via the key on the text column
  const measureLabel = useCallback((node: HTMLSpanElement | null) => {
    if (!node) return
    // A clipped nowrap line still reports its full text width through scrollWidth, so the
    // collapsed pill is sized to whichever of the label or the resolved dates is wider rather
    // than letting the shrinking flex column under-measure it
    const widest = Math.max(...Array.from(node.children, (line) => line.scrollWidth))
    setCollapsedWidth(Math.ceil(widest) + COLLAPSED_HEAD_CHROME)
  }, [])

  // The panel closes on an outside press or Escape so a stale open control never lingers
  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  /**
   * Switches preset and collapses for fixed presets while keeping Custom open for the builder
   */
  function handlePresetChange(value: InsightsRangePreset) {
    onPresetChange(value)
    if (value !== 'CUSTOM') setOpen(false)
  }

  /**
   * Applies a saved range and collapses the panel so the selection reads as final
   */
  function handleApplySavedRange(savedRange: SavedInsightsRange) {
    onApplySavedRange(savedRange)
    setOpen(false)
  }

  return (
    <motion.div
      ref={containerRef}
      className={joinClassNames(
        'app-range-glass',
        open && 'app-range-glass-open',
        fullWidth && 'app-range-glass-full',
        growUp && 'app-range-glass-up',
      )}
      animate={fullWidth ? undefined : { width: open ? OPEN_DESKTOP_WIDTH : collapsedWidth }}
      transition={transition}
      whileTap={open || shouldReduceMotion ? undefined : { scale: 0.94 }}
    >
      <button
        type="button"
        className="app-range-glass-head"
        aria-expanded={open}
        aria-label={`Insights date range: ${currentLabel}`}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="app-range-glass-cur">
          <Calendar size={15} aria-hidden className="shrink-0" />
          <span key={`${currentLabel}|${rangeLabel}`} ref={measureLabel} className="app-range-glass-text">
            <span className="truncate">{currentLabel}</span>
            <motion.span
              className="app-range-glass-sub"
              initial={false}
              animate={{ height: open ? 0 : 'auto', opacity: open ? 0 : 1 }}
              transition={transition}
            >
              {rangeLabel}
            </motion.span>
          </span>
        </span>
        <motion.span
          className="app-range-glass-chev"
          style={{ display: 'inline-flex' }}
          animate={{ rotate: open ? 180 : 0 }}
          transition={transition}
        >
          <ChevronDown size={16} aria-hidden />
        </motion.span>
      </button>

      <div className="app-range-glass-bodywrap">
        <div className="app-range-glass-body">
          <div className="app-range-glass-inner">
            <p className="mb-2 ml-0.5 text-xs" style={{ color: 'var(--app-text-muted)' }}>
              Date range
            </p>
            <div className="app-range-seg" role="tablist" aria-label="Insights date range">
              {INSIGHTS_RANGE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="tab"
                  aria-selected={option.value === preset}
                  className={joinClassNames(
                    'app-range-seg-option',
                    option.value === preset && 'app-range-seg-option-active',
                  )}
                  onClick={() => handlePresetChange(option.value)}
                >
                  {option.code}
                </button>
              ))}
            </div>

            {!isCustom && <p className="app-range-dates">{rangeLabel}</p>}

            <div className={joinClassNames('app-range-custom', isCustom && 'app-range-custom-open')}>
              <div className="app-range-custom-inner">
                <RelativeRangeBuilder
                  amount={relativeAmount}
                  unit={relativeUnit}
                  qualifier={relativeQualifier}
                  onAmountChange={onRelativeAmountChange}
                  onUnitChange={onRelativeUnitChange}
                  onQualifierChange={onRelativeQualifierChange}
                />
                <p className="app-range-dates">{rangeLabel}</p>
                <SavedRanges
                  savedRanges={savedRanges}
                  onSaveCurrentRange={onSaveCurrentRange}
                  onApplySavedRange={handleApplySavedRange}
                  onDeleteSavedRange={onDeleteSavedRange}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

/**
 * Reads how far the on-screen keyboard overlaps the bottom of the layout viewport
 */
function readKeyboardInset(): number {
  const viewport = window.visualViewport
  if (!viewport) return 0
  return Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
}

/**
 * Tracks the on-screen keyboard overlap so the bottom-fixed control can lift above it instead
 * of hiding behind it, which a plain position:fixed element does on mobile
 */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(readKeyboardInset)

  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return

    const update = () => setInset(readKeyboardInset())
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [])

  return inset
}

/**
 * Positions the insights range pill as a bottom-floating control on mobile and a sticky
 * sidebar control on wider screens
 */
export function InsightsFloatingRangeControl(props: InsightsFloatingRangeControlProps) {
  const keyboardInset = useKeyboardInset()
  const [isEditingField, setIsEditingField] = useState(false)

  // Lift the control above the keyboard only while one of its own text fields is focused. Without
  // that guard the layout-versus-visual-viewport gap from the mobile browser chrome reads as a
  // keyboard and pushes the control off the bottom, leaving empty space beneath it
  const keyboardLift = isEditingField ? keyboardInset : 0

  return (
    <>
      {/* The route-transition wrapper animates transform, which would otherwise act as the
          containing block for a position:fixed child and make it scroll with the page, so the
          bottom-floating mobile control is portaled to the body to stay pinned to the viewport */}
      {createPortal(
        <div
          className="pointer-events-none fixed inset-x-4 bottom-1.5 z-30 min-[1050px]:hidden"
          style={keyboardLift > 0 ? { transform: `translateY(-${keyboardLift}px)` } : undefined}
          onFocusCapture={(event) => setIsEditingField(event.target instanceof HTMLInputElement)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsEditingField(false)
          }}
        >
          <div className="pointer-events-auto">
            <GlassRangeSelector {...props} fullWidth growUp />
          </div>
        </div>,
        document.body,
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 top-0 z-40 hidden pt-[3.8rem] min-[1050px]:block">
        <div className="sticky top-6 flex justify-end">
          <div className="pointer-events-auto w-[24rem]">
            <GlassRangeSelector {...props} fullWidth={false} growUp={false} />
          </div>
        </div>
      </div>
    </>
  )
}
