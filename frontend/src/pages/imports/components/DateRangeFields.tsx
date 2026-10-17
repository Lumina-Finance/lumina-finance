import { useId, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import DateField from '@/components/date-field/DateField'
import {
  IMPORT_DATE_RANGE_CROSSED_FIELD_ERROR,
  IMPORT_DATE_RANGE_END_LABEL,
  IMPORT_DATE_RANGE_INCOMPLETE_FIELD_ERROR,
  IMPORT_DATE_RANGE_START_LABEL,
  IMPORT_DATE_RANGE_TITLE,
  IMPORT_LATEST_START_LABEL,
} from '@/pages/imports/constants'
import type { ImportDateRange } from '@/pages/imports/types'

// The ease and length the file step's upload slots use for growing and collapsing
const DATE_RANGE_EASE = [0.25, 0.1, 0.25, 1] as const
const DATE_RANGE_SECONDS = 0.24

/**
 * One message under the dates, which grows in and collapses out. The room above it sits inside, since
 * padding on a box whose height animates stays behind at either end
 */
function DateRangeError({ id, children }: { id: string; children: ReactNode }) {
  const shouldReduceMotion = useReducedMotion() ?? false
  return (
    <motion.div
      className="overflow-hidden"
      initial={shouldReduceMotion ? false : { height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={shouldReduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
      transition={{ duration: shouldReduceMotion ? 0 : DATE_RANGE_SECONDS, ease: DATE_RANGE_EASE }}
    >
      <p id={id} role="alert" className="text-xs font-medium leading-5 text-balance" style={{ color: 'var(--app-negative)' }}>
        {children}
      </p>
    </motion.div>
  )
}

/**
 * The dates a CSV import is limited to, both ends optional and both included, as the last row of the
 * file step's settings list: the setting's name in body text, then the start date and the end date
 * under it, one above the other at full width, each with a small label in secondary text so the
 * row's name stays the heading
 *
 * The row grows in and collapses out as a whole with its hairline, since it belongs only to a file
 * with a date column. A partly typed date is said once, under the fields, while the fields at fault
 * take the error tint and point at it. A start date after the end date is said on the start date's
 * label row, which alone takes the tint and points at it
 *
 * @param disabled - Shows the dates a finished import was limited to without letting them change
 */
export function ImportDateRangeFields({
  isShown,
  dateRange,
  isCrossed,
  disabled,
  startSuggestion,
  onChange,
}: {

  /** Whether a column is mapped as the date, which is what the range is read through */
  isShown: boolean
  dateRange: ImportDateRange
  isCrossed: boolean
  disabled: boolean

  /** The start date the user can ask for above the field, null while there is nothing to offer */
  startSuggestion: string | null
  onChange: (end: keyof ImportDateRange, value: string, isPartlyTyped: boolean) => void
}) {
  const baseId = useId()
  const shouldReduceMotion = useReducedMotion() ?? false
  const errorId = `${baseId}-error`
  const titleId = `${baseId}-title`
  const crossedErrorId = `${baseId}-crossed`
  const isIncomplete = dateRange.from === null || dateRange.to === null
  const isStartCrossed = !isIncomplete && isCrossed

  const fields = [
    { end: 'from', label: IMPORT_DATE_RANGE_START_LABEL },
    { end: 'to', label: IMPORT_DATE_RANGE_END_LABEL },
  ] as const

  return (
    <AnimatePresence initial={false}>
      {isShown && (
        <motion.div
          key="date-range"
          // Clipped only while it moves, so the fields' focus rings are not cut once it has settled
          initial={shouldReduceMotion ? false : { height: 0, opacity: 0, overflow: 'hidden' }}
          animate={{ height: 'auto', opacity: 1, transitionEnd: { overflow: 'visible' } }}
          exit={shouldReduceMotion ? { opacity: 0 } : { height: 0, opacity: 0, overflow: 'hidden' }}
          transition={{ duration: shouldReduceMotion ? 0 : DATE_RANGE_SECONDS, ease: DATE_RANGE_EASE }}
        >
          {/* The hairline sits inside, since a border on a box whose height animates to zero stays
              behind. No room is left below, so the list's own gap sets the space under the dates
              as it does under any other row */}
          <div role="group" aria-labelledby={titleId} className="flex flex-col gap-4 border-t border-[var(--app-border)] pt-4">
            <span id={titleId} className="text-sm">{IMPORT_DATE_RANGE_TITLE}</span>
            {fields.map(({ end, label }) => {
              const fieldId = `${baseId}-${end}`
              return (
                <div key={end} className="flex min-w-0 flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-3">
                    {/* Kept whole, so a message and the suggestion beside it wrap under one another
                        rather than squeezing the label onto two lines */}
                    <label htmlFor={fieldId} className="shrink-0 text-xs" style={{ color: 'var(--app-text-muted)' }}>
                      {label}
                    </label>
                    {end === 'from' && (isStartCrossed || (startSuggestion && !disabled)) && (
                      <div className="flex min-w-0 flex-wrap items-baseline justify-end gap-x-3 text-right">
                        {isStartCrossed && (
                          <p id={crossedErrorId} role="alert" className="text-xs font-medium leading-5 text-balance" style={{ color: 'var(--app-negative)' }}>
                            {IMPORT_DATE_RANGE_CROSSED_FIELD_ERROR}
                          </p>
                        )}
                        {startSuggestion && !disabled && (
                          <button
                            type="button"
                            onClick={() => onChange('from', startSuggestion, false)}
                            className="text-right text-xs font-medium underline underline-offset-2 text-[var(--app-text-muted)] transition-colors duration-200 ease-out hover:text-[var(--app-accent)] motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                          >
                            {IMPORT_LATEST_START_LABEL}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <DateField
                    id={fieldId}
                    ariaLabel={label}
                    value={dateRange[end] ?? ''}
                    error={dateRange[end] === null || (end === 'from' && isStartCrossed)}
                    describedById={end === 'from' && isStartCrossed ? crossedErrorId : errorId}
                    disabled={disabled}
                    onChange={(value, isPartlyTyped) => onChange(end, value, isPartlyTyped)}
                  />
                </div>
              )
            })}
            <AnimatePresence initial={false}>
              {isIncomplete && (
                <DateRangeError key="incomplete" id={errorId}>{IMPORT_DATE_RANGE_INCOMPLETE_FIELD_ERROR}</DateRangeError>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
