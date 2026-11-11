import { AnimatePresence } from 'motion/react'
import type { BankImportRange } from '@/api/bank-sync'
import { ChoiceCard } from '@/components/bank-link-flow/ChoiceCard'
import { LINK_FLOW_FIELD_IDS, rangeEndsBeforeTodayNote } from '@/components/bank-link-flow/constants'
import { BankDateRangeFields } from '@/components/bank-link-flow/DateRangeFields'
import { CUSTOM_START, type StartChoiceState } from '@/components/bank-link-flow/useStartChoice'
import { Unfold } from '@/components/display/Unfold'
import { FieldError } from '@/components/forms/FieldError'
import { InfoCallout } from '@/components/InfoCallout'
import { formatDateLabel } from '@/utils/date'

type StartStepProps = {
  range: BankImportRange
  bankAccountName: string
  providerName: string

  /** Whether the provider says how much history it holds for each bank, and that makes its limit a promise */
  advertisesHistory: boolean
  startChoice: StartChoiceState

  /** What a refused press, or leaving a date, found wrong with the choice or the custom dates */
  errors: { startChoice?: string; rangeFrom?: string; rangeTo?: string }

  /** Told when focus leaves one of the custom dates, so a date left wrong is marked before any press */
  onRangeBlur: (field: 'rangeFrom' | 'rangeTo') => void
  disabled: boolean
}

/**
 * Chooses the days an import covers: a preset counted back from the provider's limit, the days after
 * the account's latest transaction, or custom dates. Custom dates unfold From and To inside their own
 * card, with To at today, and a To moved before today says syncing picks up from today
 */
export function StartStep({
  range,
  bankAccountName,
  providerName,
  advertisesHistory,
  startChoice,
  errors,
  onRangeBlur,
  disabled,
}: StartStepProps) {
  const { choice, choose, choices, uncoveredUntil, dateRange } = startChoice
  const custom = choice === CUSTOM_START

  // A whole To before today leaves the days after it to the user, and the step says so
  const endsBeforeToday =
    dateRange.to !== '' && dateRange.to < range.latest_allowed && dateRange.getToDisabledReason(dateRange.to) === null

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
        Choose the days {bankAccountName} brings in. Each transaction waits for your review.
      </p>
      <div className="space-y-2">
        <div
          className="space-y-2"
          role="radiogroup"
          aria-label="Start"
          aria-invalid={errors.startChoice ? true : undefined}
          aria-describedby={errors.startChoice ? LINK_FLOW_FIELD_IDS.startChoiceError : undefined}
        >
          {choices.map((preset, index) => (
            <ChoiceCard
              key={preset.key}
              id={index === 0 ? LINK_FLOW_FIELD_IDS.startChoice : undefined}
              selected={choice === preset.key}
              disabled={disabled}
              onSelect={() => choose(preset.key)}
            >
              <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-sm font-medium" style={{ color: 'var(--app-text)' }}>
                  {preset.label}
                </span>
                <span className="text-sm tabular-nums" style={{ color: 'var(--app-text-muted)' }}>
                  From {formatDateLabel(preset.date)}
                </span>
              </span>
              {preset.note && (
                <span className="block text-xs" style={{ color: 'var(--app-text-muted)' }}>
                  {preset.note}
                </span>
              )}
            </ChoiceCard>
          ))}
          <ChoiceCard
            id={choices.length === 0 ? LINK_FLOW_FIELD_IDS.startChoice : undefined}
            selected={custom}
            disabled={disabled}
            onSelect={() => choose(CUSTOM_START)}
            extra={
              <AnimatePresence initial={false}>
                {custom && (
                  <Unfold key="custom-dates" flush clipsOnlyWhileChanging>
                    {/* Indented to the choice's label, past the radio and its gap */}
                    <div role="group" aria-label="Custom dates" className="pb-3.5 pl-[2.625rem] pr-3.5">
                      <BankDateRangeFields
                        dateRange={dateRange}
                        ids={{ from: LINK_FLOW_FIELD_IDS.rangeFrom, to: LINK_FLOW_FIELD_IDS.rangeTo }}
                        errors={{ from: errors.rangeFrom, to: errors.rangeTo }}
                        onBlur={(end) => onRangeBlur(end === 'from' ? 'rangeFrom' : 'rangeTo')}
                        disabled={disabled}
                      />
                      <p className="pt-2 text-xs" style={{ color: 'var(--app-text-muted)' }}>
                        Any days from {formatDateLabel(range.earliest_allowed)} to today
                      </p>
                      <AnimatePresence initial={false}>
                        {endsBeforeToday && (
                          <Unfold key="ends-before-today" flush>
                            <p className="pt-1 text-xs" style={{ color: 'var(--app-text-muted)' }}>
                              {rangeEndsBeforeTodayNote(formatDateLabel(dateRange.to))}
                            </p>
                          </Unfold>
                        )}
                      </AnimatePresence>
                    </div>
                  </Unfold>
                )}
              </AnimatePresence>
            }
          >
            <span className="block text-sm font-medium" style={{ color: 'var(--app-text)' }}>
              Custom dates
            </span>
          </ChoiceCard>
        </div>
        <FieldError message={errors.startChoice} id={LINK_FLOW_FIELD_IDS.startChoiceError} />
        {!advertisesHistory && (
          <p className="text-xs" style={{ color: 'var(--app-text-muted)' }}>
            {providerName} reaches back up to {range.provider_history_months} months, but some banks keep less.
          </p>
        )}
      </div>
      {uncoveredUntil && range.ledger_floor && (
        <InfoCallout>
          {formatDateLabel(range.ledger_floor)} to {formatDateLabel(uncoveredUntil)} won't be imported. Please add any
          transactions from those days by hand.
        </InfoCallout>
      )}
    </div>
  )
}
