import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { parseIsoDate } from '@/components/date-field/dateSegments'
import { useAuth } from '@/hooks/useAuth'
import { formatYmd, getTodayYmd, getWeekdayIndex } from '@/utils/date'

interface CalendarPopoverProps {
  open: boolean
  anchorRef: RefObject<HTMLElement | null>
  // Selected date as an ISO yyyy-mm-dd string, empty when nothing is chosen yet
  value: string
  onSelect: (value: string) => void
  onClose: () => void
}

const POPOVER_WIDTH = 264
const POPOVER_ESTIMATED_HEIGHT = 320
const VIEWPORT_MARGIN = 8
const WEEKDAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const GRID_CELL_COUNT = 42
const DAYS_PER_WEEK = 7

/**
 * Builds the six week rows shown for a month, including the trailing days of adjacent months that
 * fill the leading and closing cells
 */
function buildMonthGrid(year: number, month: number): Date[] {
  const firstOfMonth = new Date(year, month - 1, 1)
  // Columns run Monday to Sunday to match WEEKDAY_LABELS and the week the rest of the product buckets by
  const gridStart = new Date(year, month - 1, 1 - getWeekdayIndex(firstOfMonth))

  return Array.from({ length: GRID_CELL_COUNT }, (_, index) => (
    new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index)
  ))
}

/**
 * Positions the popover under the anchor and flips it above when the viewport lacks room below
 */
function useCalendarPosition(open: boolean, anchorRef: RefObject<HTMLElement | null>) {
  const [position, setPosition] = useState({ top: 0, left: 0 })

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current
    if (!anchor) return

    const rect = anchor.getBoundingClientRect()
    const flipsUp = rect.bottom + POPOVER_ESTIMATED_HEIGHT + VIEWPORT_MARGIN > window.innerHeight
    const top = flipsUp ? rect.top - POPOVER_ESTIMATED_HEIGHT - 6 : rect.bottom + 6
    const left = Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN)

    setPosition({ top: Math.max(top, VIEWPORT_MARGIN), left: Math.max(left, VIEWPORT_MARGIN) })
  }, [anchorRef])

  useEffect(() => {
    if (!open) return

    let frame = 0
    const updateOnFrame = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(updatePosition)
    }

    updateOnFrame()
    window.addEventListener('resize', updateOnFrame)
    window.addEventListener('scroll', updateOnFrame, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', updateOnFrame)
      window.removeEventListener('scroll', updateOnFrame, true)
    }
  }, [open, updatePosition])

  return position
}

/**
 * Renders a floating month grid for picking a date, keeping the browser calendar out of the flow so
 * the date field stays consistent across browsers
 */
export default function CalendarPopover({ open, anchorRef, value, onSelect, onClose }: CalendarPopoverProps) {
  const position = useCalendarPosition(open, anchorRef)
  const gridRef = useRef<HTMLDivElement>(null)
  const prefersReducedMotion = useReducedMotion()

  const { user } = useAuth()

  // The ring marks the user's own today, which their profile zone decides rather than the browser's
  const todayIso = getTodayYmd(user?.tz)

  // The visible month follows the selected value while open, falling back to the current month
  const [viewMonth, setViewMonth] = useState(() => initialViewMonth(value, todayIso))
  const [focusedIso, setFocusedIso] = useState(() => value || todayIso)

  // Sign of the last month change so the grid slides toward the month being revealed
  const [direction, setDirection] = useState(0)

  // Reset the visible month and focused day to the selection each time the popover opens. This adjusts
  // state during render rather than in an effect so it lands before the grid first paints
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setViewMonth(initialViewMonth(value, todayIso))
      setFocusedIso(value || todayIso)
    }
  }

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (gridRef.current?.contains(target) || anchorRef.current?.contains(target)) return
      onClose()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open, anchorRef, onClose])

  const monthKey = `${viewMonth.year}-${viewMonth.month}`

  // Focus follows the keyboard through the grid so the active day is always visible. The lookup is
  // scoped to the current month so the outgoing grid's edge days do not capture focus mid transition
  useEffect(() => {
    if (!open) return

    const active = gridRef.current?.querySelector<HTMLButtonElement>(
      `[data-monthkey="${monthKey}"] [data-iso="${focusedIso}"]`,
    )
    active?.focus({ preventScroll: true })
  }, [open, focusedIso, monthKey])

  const changeMonth = (delta: number) => {
    setDirection(delta)
    setViewMonth((current) => {
      const next = new Date(current.year, current.month - 1 + delta, 1)
      return { year: next.getFullYear(), month: next.getMonth() + 1 }
    })
  }

  /**
   * Moves the focused day by a number of days, following the grid across month boundaries
   */
  const moveFocus = (dayDelta: number) => {
    const current = parseIsoDate(focusedIso)
    const base = new Date(Number(current.year), Number(current.month) - 1, Number(current.day))
    const next = new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayDelta)
    setDirection(Math.sign(dayDelta))
    setFocusedIso(formatYmd(next))
    setViewMonth({ year: next.getFullYear(), month: next.getMonth() + 1 })
  }

  const slideOffset = prefersReducedMotion ? 0 : 26
  const monthGridVariants = {
    enter: (towards: number) => ({ x: towards >= 0 ? slideOffset : -slideOffset, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (towards: number) => ({ x: towards >= 0 ? -slideOffset : slideOffset, opacity: 0 }),
  }

  const handleGridKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault()
        moveFocus(-1)
        break
      case 'ArrowRight':
        event.preventDefault()
        moveFocus(1)
        break
      case 'ArrowUp':
        event.preventDefault()
        moveFocus(-DAYS_PER_WEEK)
        break
      case 'ArrowDown':
        event.preventDefault()
        moveFocus(DAYS_PER_WEEK)
        break
      case 'PageUp':
        event.preventDefault()
        changeMonth(-1)
        break
      case 'PageDown':
        event.preventDefault()
        changeMonth(1)
        break
      case 'Escape':
        event.preventDefault()
        onClose()
        break
      default:
        break
    }
  }

  const cells = buildMonthGrid(viewMonth.year, viewMonth.month)

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={gridRef}
          role="dialog"
          aria-label="Choose date"
          className="fixed z-[70] rounded-xl p-3"
          style={{
            top: position.top,
            left: position.left,
            width: POPOVER_WIDTH,
            background: 'var(--app-input-bg)',
            border: '1px solid var(--app-border-strong)',
            boxShadow: 'var(--app-shadow-soft)',
          }}
          initial={{ opacity: 0, scale: 0.97, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: -4 }}
          transition={{ duration: 0.14, ease: [0.25, 0.1, 0.25, 1] }}
          onKeyDown={handleGridKeyDown}
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              aria-label="Previous month"
              className="app-icon-button h-7 w-7"
              onClick={() => changeMonth(-1)}
            >
              <ChevronLeft size={16} aria-hidden />
            </button>
            <span className="text-sm font-medium">
              {MONTH_LABELS[viewMonth.month - 1]} {viewMonth.year}
            </span>
            <button
              type="button"
              aria-label="Next month"
              className="app-icon-button h-7 w-7"
              onClick={() => changeMonth(1)}
            >
              <ChevronRight size={16} aria-hidden />
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7 gap-0.5">
            {WEEKDAY_LABELS.map((weekday) => (
              <span
                key={weekday}
                className="text-center text-[0.6875rem] font-medium"
                style={{ color: 'var(--app-text-subtle)' }}
              >
                {weekday}
              </span>
            ))}
          </div>

          <div className="relative overflow-hidden">
            <AnimatePresence initial={false} mode="popLayout" custom={direction}>
              <motion.div
                key={monthKey}
                data-monthkey={monthKey}
                custom={direction}
                variants={monthGridVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: prefersReducedMotion ? 0.12 : 0.2, ease: [0.25, 0.1, 0.25, 1] }}
                className="grid w-full grid-cols-7 gap-0.5"
              >
                {cells.map((date) => {
                  const iso = formatYmd(date)
                  const inMonth = date.getMonth() + 1 === viewMonth.month
                  const isSelected = iso === value
                  const isToday = iso === todayIso

                  return (
                    <button
                      key={iso}
                      type="button"
                      data-iso={iso}
                      tabIndex={iso === focusedIso ? 0 : -1}
                      aria-pressed={isSelected}
                      onClick={() => {
                        onSelect(iso)
                        onClose()
                      }}
                      className="app-calendar-day"
                      data-selected={isSelected || undefined}
                      data-today={isToday || undefined}
                      data-outside={!inMonth || undefined}
                    >
                      {date.getDate()}
                    </button>
                  )
                })}
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

/**
 * Resolves the month first shown when the popover opens from the selected value or today
 *
 * @param value - Selected date as an ISO yyyy-mm-dd string, empty when nothing is chosen yet
 * @param todayIso - Today in the user's own zone, used when nothing is selected
 */
function initialViewMonth(value: string, todayIso: string): { year: number; month: number } {
  const parsed = parseIsoDate(value || todayIso)

  return { year: Number(parsed.year), month: Number(parsed.month) }
}
