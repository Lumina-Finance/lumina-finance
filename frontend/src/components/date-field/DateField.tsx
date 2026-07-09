import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type FocusEvent as ReactFocusEvent } from 'react'
import { Calendar } from 'lucide-react'
import CalendarPopover from '@/components/date-field/CalendarPopover'
import {
  SEGMENT_MAX_LENGTH,
  SEGMENT_ORDER,
  formatIsoDate,
  parseIsoDate,
  setSegmentDigits,
  shouldAdvanceSegment,
  stepSegment,
  type DateSegmentName,
  type DateSegments,
} from '@/components/date-field/dateSegments'

interface DateFieldProps {
  // Selected date as an ISO yyyy-mm-dd string, empty while the date is incomplete
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  id?: string
  ariaLabel?: string
  disabled?: boolean
  readOnly?: boolean
  error?: boolean
}

const SEGMENT_PLACEHOLDER: Record<DateSegmentName, string> = { year: 'yyyy', month: 'mm', day: 'dd' }
const SEGMENT_LABEL: Record<DateSegmentName, string> = { year: 'Year', month: 'Month', day: 'Day' }
const SEGMENT_WIDTH: Record<DateSegmentName, string> = { year: 'w-[4ch]', month: 'w-[2ch]', day: 'w-[2ch]' }

/**
 * Pads a single filled digit to two characters so month and day read tidily once focus leaves
 */
function padSegmentForDisplay(segment: DateSegmentName, digits: string): string {
  if (segment === 'year' || digits.length !== 1) return digits
  if (Number.parseInt(digits, 10) < 1) return digits

  return digits.padStart(2, '0')
}

/**
 * Renders a segmented year, month, and day date control backed by a calendar popover, clamping every
 * edit to a real date so an invalid combination such as February 31 can never blank the field
 */
export default function DateField({
  value,
  onChange,
  onBlur,
  id,
  ariaLabel,
  disabled = false,
  readOnly = false,
  error = false,
}: DateFieldProps) {
  const [segments, setSegments] = useState<DateSegments>(() => parseIsoDate(value))
  const [popoverOpen, setPopoverOpen] = useState(false)
  const lastEmittedRef = useRef(value)
  const containerRef = useRef<HTMLDivElement>(null)
  const segmentRefs = useRef<Record<DateSegmentName, HTMLInputElement | null>>({ year: null, month: null, day: null })

  // The next digit typed into a freshly focused segment overwrites it rather than appending, matching
  // how a native date field starts each segment over once focus lands on it
  const overwriteOnNextDigitRef = useRef(true)

  // Re-sync from the value prop only on an external change so an in-progress edit is never discarded
  useEffect(() => {
    if (value === lastEmittedRef.current) return

    lastEmittedRef.current = value
    setSegments(parseIsoDate(value))
  }, [value])

  const commit = useCallback((next: DateSegments) => {
    setSegments(next)
    const iso = formatIsoDate(next)
    lastEmittedRef.current = iso
    onChange(iso)
  }, [onChange])

  const focusSegment = (segment: DateSegmentName) => {
    segmentRefs.current[segment]?.focus()
  }

  /**
   * Moves focus to the neighbouring segment, staying put at the ends of the field
   */
  const focusRelative = (segment: DateSegmentName, delta: number) => {
    const next = SEGMENT_ORDER[SEGMENT_ORDER.indexOf(segment) + delta]
    if (next) focusSegment(next)
  }

  /**
   * Applies a typed digit, overwriting a freshly focused or already full segment and advancing to the
   * next segment once the current one can no longer grow
   */
  const appendDigit = (segment: DateSegmentName, digit: string) => {
    const startsOver = overwriteOnNextDigitRef.current || segments[segment].length >= SEGMENT_MAX_LENGTH[segment]
    overwriteOnNextDigitRef.current = false

    const next = setSegmentDigits(segments, segment, (startsOver ? '' : segments[segment]) + digit)
    commit(next)

    if (shouldAdvanceSegment(segment, next[segment])) focusRelative(segment, 1)
  }

  /**
   * Handles input from soft keyboards that do not emit key events, syncing whatever digits the field
   * now holds
   */
  const handleSegmentInput = (segment: DateSegmentName, rawValue: string) => {
    const next = setSegmentDigits(segments, segment, rawValue)
    commit(next)

    if (shouldAdvanceSegment(segment, next[segment])) focusRelative(segment, 1)
  }

  const handleSegmentKeyDown = (segment: DateSegmentName, event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (readOnly) return

    if (/^\d$/.test(event.key)) {
      event.preventDefault()
      appendDigit(segment, event.key)
      return
    }

    const input = event.currentTarget
    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault()
        commit(stepSegment(segments, segment, 1, new Date()))
        break
      case 'ArrowDown':
        event.preventDefault()
        commit(stepSegment(segments, segment, -1, new Date()))
        break
      case 'ArrowRight':
        if ((input.selectionEnd ?? 0) >= input.value.length) {
          event.preventDefault()
          focusRelative(segment, 1)
        }
        break
      case 'ArrowLeft':
        if ((input.selectionStart ?? 0) === 0) {
          event.preventDefault()
          focusRelative(segment, -1)
        }
        break
      case 'Backspace':
        event.preventDefault()
        if (segments[segment] === '') {
          focusRelative(segment, -1)
        } else {
          overwriteOnNextDigitRef.current = true
          commit(setSegmentDigits(segments, segment, ''))
        }
        break
      case '/':
      case '-':
      case '.':
        event.preventDefault()
        focusRelative(segment, 1)
        break
      default:
        break
    }
  }

  /**
   * Tidies single digit month and day values once focus leaves the whole field
   */
  const handleContainerBlur = (event: ReactFocusEvent<HTMLDivElement>) => {
    if (containerRef.current?.contains(event.relatedTarget as Node)) return

    setSegments((current) => ({
      year: current.year,
      month: padSegmentForDisplay('month', current.month),
      day: padSegmentForDisplay('day', current.day),
    }))
    onBlur?.()
  }

  return (
    <div className="relative">
      <div
        ref={containerRef}
        role="group"
        aria-label={ariaLabel}
        onBlur={handleContainerBlur}
        className={`app-date-field ${error ? 'app-input-error' : ''} ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
      >
        {SEGMENT_ORDER.map((segment, index) => (
          <div key={segment} className="flex items-center">
            {index > 0 && (
              <span className="px-0.5 select-none" aria-hidden style={{ color: 'var(--app-text-subtle)' }}>
                -
              </span>
            )}
            <input
              ref={(node) => { segmentRefs.current[segment] = node }}
              id={segment === 'year' ? id : undefined}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              aria-label={SEGMENT_LABEL[segment]}
              placeholder={SEGMENT_PLACEHOLDER[segment]}
              disabled={disabled}
              readOnly={readOnly}
              value={segments[segment]}
              onFocus={(event) => {
                overwriteOnNextDigitRef.current = true
                event.currentTarget.select()
              }}
              onChange={(event) => handleSegmentInput(segment, event.target.value)}
              onKeyDown={(event) => handleSegmentKeyDown(segment, event)}
              className={`app-date-field-segment ${SEGMENT_WIDTH[segment]} ${disabled ? 'cursor-not-allowed' : ''}`}
            />
          </div>
        ))}

        <button
          type="button"
          aria-label="Open calendar"
          tabIndex={-1}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setPopoverOpen((open) => !open)}
          className="ml-auto shrink-0 cursor-pointer border-0 bg-transparent p-0 disabled:cursor-not-allowed"
          style={{ color: 'var(--app-text-subtle)' }}
        >
          <Calendar size={15} aria-hidden className="block" />
        </button>
      </div>

      <CalendarPopover
        open={popoverOpen && !disabled && !readOnly}
        anchorRef={containerRef}
        value={value}
        onSelect={(iso) => commit(parseIsoDate(iso))}
        onClose={() => setPopoverOpen(false)}
      />
    </div>
  )
}
