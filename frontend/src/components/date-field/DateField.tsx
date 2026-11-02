import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type FocusEvent as ReactFocusEvent,
  type Ref,
} from 'react'
import { Calendar } from 'lucide-react'
import CalendarPopover from '@/components/date-field/CalendarPopover'
import {
  SEGMENT_MAX_LENGTH,
  SEGMENT_ORDER,
  formatIsoDate,
  isPartlyTyped,
  parseIsoDate,
  setSegmentDigits,
  shouldAdvanceSegment,
  stepSegment,
  type DateSegmentName,
  type DateSegments,
} from '@/components/date-field/dateSegments'
import { useAuth } from '@/hooks/useAuth'
import { getTodayDate } from '@/utils/date'

export type DateFieldHandle = {
  // Empties all three segments as if they had been erased by hand, then focuses the year, so a control
  // outside the field can clear it, including a date only partly typed, which the value prop cannot
  // empty since it already reads as empty
  clear: () => void
}

interface DateFieldProps {
  ref?: Ref<DateFieldHandle>
  // Selected date as an ISO yyyy-mm-dd string, empty while the date is incomplete
  value: string

  // isPartlyTyped tells an empty value from a date begun but not finished, for a caller that has to
  // treat the two differently
  onChange: (value: string, isPartlyTyped: boolean) => void
  onBlur?: () => void
  id?: string
  ariaLabel?: string
  disabled?: boolean
  readOnly?: boolean
  error?: boolean

  // Names the message explaining the error, which each segment points at while error is set so the
  // reason is announced wherever focus lands in the field
  describedById?: string

  // A shortcut elsewhere on the page that jumps to the field, written as aria-keyshortcuts writes it
  // and put on the year, where the jump lands
  keyShortcuts?: string

  // Lights the field with its focus look without moving focus into it: 'lit' while a change made elsewhere is
  // pointed out, 'fading' while the light eases out again. Left out, or null, the field is as focus makes it
  stepHighlight?: 'lit' | 'fading' | null
}

const SEGMENT_PLACEHOLDER: Record<DateSegmentName, string> = { year: 'yyyy', month: 'mm', day: 'dd' }
const SEGMENT_LABEL: Record<DateSegmentName, string> = { year: 'Year', month: 'Month', day: 'Day' }
// Sized for the yyyy, mm and dd placeholders rather than for digits, since a letter is wider than a
// figure and an input clips whatever does not fit. Measured in the interface font, they need 3.40ch,
// 2.68ch and 1.89ch, and month and day share a width so the two dashes sit symmetrically
const SEGMENT_WIDTH: Record<DateSegmentName, string> = { year: 'w-[4ch]', month: 'w-[3ch]', day: 'w-[3ch]' }

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
  ref,
  value,
  onChange,
  onBlur,
  id,
  ariaLabel,
  disabled = false,
  readOnly = false,
  error = false,
  describedById,
  keyShortcuts,
  stepHighlight = null,
}: DateFieldProps) {
  const { user } = useAuth()
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

  const commit = useCallback(
    (next: DateSegments) => {
      setSegments(next)
      const iso = formatIsoDate(next)
      lastEmittedRef.current = iso
      onChange(iso, isPartlyTyped(next))
    },
    [onChange],
  )

  const focusSegment = (segment: DateSegmentName) => {
    segmentRefs.current[segment]?.focus()
  }

  useImperativeHandle(
    ref,
    () => ({
      clear: () => {
        commit(parseIsoDate(''))
        focusSegment('year')
      },
    }),
    [commit],
  )

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
        commit(stepSegment(segments, segment, 1, getTodayDate(user?.tz)))
        break
      case 'ArrowDown':
        event.preventDefault()
        commit(stepSegment(segments, segment, -1, getTodayDate(user?.tz)))
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

  /**
   * Sends a press on the field's empty space to the year, as a press on the year itself would. The
   * default is prevented so the press does not first drop focus onto the page
   */
  const handleContainerMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (disabled || readOnly) return
    if ((event.target as Element).closest('input, button')) return

    event.preventDefault()
    focusSegment('year')
  }

  return (
    <div className="relative">
      <div
        ref={containerRef}
        role="group"
        aria-label={ariaLabel}
        onBlur={handleContainerBlur}
        onMouseDown={handleContainerMouseDown}
        data-step-highlight={stepHighlight ?? undefined}
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
              ref={(node) => {
                segmentRefs.current[segment] = node
              }}
              id={segment === 'year' ? id : undefined}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              aria-label={SEGMENT_LABEL[segment]}
              aria-keyshortcuts={segment === 'year' ? keyShortcuts : undefined}
              aria-invalid={error}
              aria-describedby={error ? describedById : undefined}
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
          aria-haspopup="dialog"
          aria-expanded={popoverOpen}
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
