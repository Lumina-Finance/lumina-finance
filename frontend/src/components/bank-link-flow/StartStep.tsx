import type { BankImportRange } from '@/api/bank-sync'
import { ChoiceCard } from '@/components/bank-link-flow/ChoiceCard'
import { LINK_FLOW_FIELD_IDS } from '@/components/bank-link-flow/constants'
import { CUSTOM_START, type StartChoiceState } from '@/components/bank-link-flow/useStartChoice'
import DateField from '@/components/date-field/DateField'
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

  /** What a refused press, or leaving the date, found wrong with the choice or the custom date */
  errors: { startChoice?: string; startDate?: string }

  /** Told when focus leaves the custom date, so a date left wrong is marked before any press */
  onDateBlur: () => void
  disabled: boolean
}

/**
 * Chooses the day an import starts on: a preset counted back from the provider's limit, raised to
 * the day after the account's latest transaction, or a custom date inside the range
 */
export function StartStep({
  range,
  bankAccountName,
  providerName,
  advertisesHistory,
  startChoice,
  errors,
  onDateBlur,
  disabled,
}: StartStepProps) {
  const {
    choice,
    choose,
    customStart,
    setCustomStart,
    choices,
    isDateDisabled,
    getDateDisabledReason,
    uncoveredUntil,
  } = startChoice

  return (
    <div className="space-y-4">
      <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
        {bankAccountName} brings in transactions from the start you choose through today. Each one waits for your review
        first.
      </p>
      <div
        className="space-y-3"
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
              <span className="text-sm tabular-nums" style={{ color: 'var(--app-text)' }}>
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
          selected={choice === CUSTOM_START}
          disabled={disabled}
          onSelect={() => choose(CUSTOM_START)}
          extra={
            // From sm up the field sits where the other choices show their date and stays in
            // view, choosing Custom once it's pressed or typed in. Focus alone doesn't choose it,
            // since the modal focuses its first field on opening. Narrower, it opens beneath the
            // label once Custom is chosen, growing through its grid row rather than snapping
            <div
              className={`grid transition-[grid-template-rows,opacity,visibility] sm:visible sm:w-[11.875rem] sm:shrink-0 sm:grid-rows-[1fr] sm:opacity-100 ${choice === CUSTOM_START ? 'visible grid-rows-[1fr] opacity-100' : 'invisible grid-rows-[0fr] opacity-0'}`}
              onPointerDownCapture={() => choose(CUSTOM_START)}
              onKeyDownCapture={(event) => {
                if (event.key !== 'Tab' && event.key !== 'Escape') choose(CUSTOM_START)
              }}
            >
              <div className="min-h-0 overflow-hidden sm:overflow-visible">
                {/* Indented to the choice's label, past the radio and its gap, on phones */}
                <div className="pb-3.5 pl-[2.625rem] pr-3.5 sm:py-3.5 sm:pl-0">
                  <DateField
                    id={LINK_FLOW_FIELD_IDS.startDate}
                    value={customStart}
                    ariaLabel="Start date"
                    disabled={disabled}
                    error={Boolean(errors.startDate)}
                    describedById={errors.startDate ? LINK_FLOW_FIELD_IDS.startDateError : undefined}
                    isDateDisabled={isDateDisabled}
                    getDateDisabledReason={getDateDisabledReason}
                    onChange={setCustomStart}
                    onBlur={onDateBlur}
                  />
                  <FieldError message={errors.startDate} id={LINK_FLOW_FIELD_IDS.startDateError} className="mt-1.5" />
                </div>
              </div>
            </div>
          }
        >
          <span className="block text-sm font-medium" style={{ color: 'var(--app-text)' }}>
            Custom date
          </span>
          <span className="block text-xs" style={{ color: 'var(--app-text-muted)' }}>
            Any day from {formatDateLabel(range.earliest_allowed)}
          </span>
        </ChoiceCard>
      </div>
      <FieldError message={errors.startChoice} id={LINK_FLOW_FIELD_IDS.startChoiceError} />
      {!advertisesHistory && (
        <InfoCallout>
          You can import up to {range.provider_history_months} months from {providerName}, but it doesn't say how much
          history each bank keeps. Some return less.
        </InfoCallout>
      )}
      {uncoveredUntil && range.ledger_floor && (
        <InfoCallout>
          Nothing covers {formatDateLabel(range.ledger_floor)} to {formatDateLabel(uncoveredUntil)}. Add those days by
          hand if you need them.
        </InfoCallout>
      )}
    </div>
  )
}
