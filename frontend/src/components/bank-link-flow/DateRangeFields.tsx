import { RANGE_CROSSED_MESSAGE } from '@/components/bank-link-flow/constants'
import type { BankDateRangeState } from '@/components/bank-link-flow/dateRange'
import DateField from '@/components/date-field/DateField'
import { FieldError } from '@/components/forms/FieldError'

type BankDateRangeFieldsProps = {
  dateRange: BankDateRangeState

  /** The id each date's field takes. A refused press focuses the field by it */
  ids: { from: string; to: string }

  /** What a refused press, or leaving a date, found wrong with each end */
  errors: { from?: string; to?: string }

  /** Told when focus leaves a date, so a date left wrong is marked before any press */
  onBlur: (end: 'from' | 'to') => void
  disabled: boolean
}

/**
 * The From and To dates of a bank date range, side by side from sm up and one above the other on a
 * phone. Each date's problem is said on its own label row, and a From after To is said on From's as
 * soon as both are whole, since no import can cover it
 */
export function BankDateRangeFields({ dateRange, ids, errors, onBlur, disabled }: BankDateRangeFieldsProps) {
  const fromError = errors.from ?? (dateRange.crossed ? RANGE_CROSSED_MESSAGE : undefined)
  const fields = [
    {
      end: 'from',
      label: 'From',
      value: dateRange.from,
      onChange: dateRange.setFrom,
      error: fromError,
      isDateDisabled: dateRange.isFromDisabled,
      getDateDisabledReason: dateRange.getFromDisabledReason,
    },
    {
      end: 'to',
      label: 'To',
      value: dateRange.to,
      onChange: dateRange.setTo,
      error: errors.to,
      isDateDisabled: dateRange.isToDisabled,
      getDateDisabledReason: dateRange.getToDisabledReason,
    },
  ] as const

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((field) => {
        const id = ids[field.end]
        const errorId = `${id}-error`
        return (
          <div key={field.end} className="flex min-w-0 flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor={id} className="shrink-0 text-xs" style={{ color: 'var(--app-text-muted)' }}>
                {field.label}
              </label>
              <FieldError message={field.error} id={errorId} sequential />
            </div>
            <DateField
              id={id}
              value={field.value}
              ariaLabel={field.label}
              disabled={disabled}
              error={Boolean(field.error)}
              describedById={field.error ? errorId : undefined}
              isDateDisabled={field.isDateDisabled}
              getDateDisabledReason={field.getDateDisabledReason}
              onChange={(value) => field.onChange(value)}
              onBlur={() => onBlur(field.end)}
            />
          </div>
        )
      })}
    </div>
  )
}
