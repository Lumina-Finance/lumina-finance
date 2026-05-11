import type { BudgetFormErrorGetter, BudgetFormFieldIds, BudgetFormHandlers, BudgetFormViewState } from '@/budgets/components/budget-form/budgetFormTypes'
import FieldLabelRow from '@/budgets/components/shared/FieldLabelRow'
import { RECURRENCE_OPTIONS } from '@/budgets/constants'
import { cadenceSummary } from '@/budgets/utils/budgetPeriods'

interface BudgetFormCadenceSectionProps {
  state: BudgetFormViewState
  ids: BudgetFormFieldIds
  periodStartLabel: string
  cadenceSummaryText?: string
  recurrenceControlsLocked: boolean
  showError: BudgetFormErrorGetter
  handlers: BudgetFormHandlers
}

export default function BudgetFormCadenceSection({
  state,
  ids,
  periodStartLabel,
  cadenceSummaryText,
  recurrenceControlsLocked,
  showError,
  handlers,
}: BudgetFormCadenceSectionProps) {
  const { form } = state
  const { setField, onBlur, onRecursChange } = handlers

  return (
    <div className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3">
      <div className="flex min-h-0 flex-col items-center">
        <span className="flex h-4 shrink-0 items-center text-xs font-semibold leading-none" style={{ color: 'var(--app-accent)' }} aria-hidden>
          02
        </span>
        <span
          className="mt-1 w-px flex-1"
          style={{ backgroundColor: 'var(--app-border-strong)' }}
          aria-hidden
        />
      </div>

      <div className="min-w-0 space-y-2.5">
        <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>Cadence</p>

        <div className="grid gap-2.5 md:grid-cols-[10rem_minmax(0,1fr)] md:items-end">
          <div>
            <span className="app-label mb-1.5 block text-[0.9375rem] leading-5">Type</span>
            <div className="app-segmented-control w-full">
              <button
                type="button"
                className={`app-segmented-option flex-1 text-sm ${form.recurs ? 'app-segmented-option-active' : ''}`}
                onClick={() => onRecursChange(true)}
              >
                Recurring
              </button>
              <button
                type="button"
                className={`app-segmented-option flex-1 text-sm ${!form.recurs ? 'app-segmented-option-active' : ''}`}
                onClick={() => onRecursChange(false)}
              >
                Once
              </button>
            </div>
          </div>

          <div>
            <span className="app-label mb-1.5 block text-[0.9375rem] leading-5">Frequency</span>
            {/* Edit locks recurrence cadence because changing it requires creating future periods differently. */}
            <div className={`app-segmented-control w-full ${recurrenceControlsLocked ? 'opacity-60' : ''}`}>
              {RECURRENCE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`app-segmented-option flex-1 text-sm ${recurrenceControlsLocked ? 'cursor-not-allowed' : ''} ${form.recurrenceFreq === option.value ? 'app-segmented-option-active' : ''}`}
                  onClick={() => setField('recurrenceFreq', option.value)}
                  disabled={recurrenceControlsLocked}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-[10rem_minmax(0,1fr)]">
          <div className={`min-w-0 ${recurrenceControlsLocked || !form.recurs ? 'opacity-60' : ''}`}>
            <FieldLabelRow
              htmlFor={ids.interval}
              label="Period length"
              error={showError('instanceLength')}
            />
            <input
              id={ids.interval}
              className={`app-input disabled:cursor-not-allowed ${showError('instanceLength') ? 'app-input-error' : ''}`}
              inputMode="numeric"
              value={form.instanceLength}
              onChange={(event) => setField('instanceLength', event.target.value.replace(/\D/g, ''))}
              onBlur={() => onBlur('instanceLength')}
              disabled={recurrenceControlsLocked || !form.recurs}
              readOnly={recurrenceControlsLocked}
            />
          </div>

          <div className={`min-w-0 ${recurrenceControlsLocked ? 'opacity-60' : ''}`}>
            <FieldLabelRow htmlFor={ids.periodStart} label={periodStartLabel} error={showError('periodStart')} />
            <input
              id={ids.periodStart}
              className={`app-input disabled:cursor-not-allowed ${showError('periodStart') ? 'app-input-error' : ''}`}
              type="date"
              value={form.periodStart}
              onChange={(event) => setField('periodStart', event.target.value)}
              onBlur={() => onBlur('periodStart')}
              disabled={recurrenceControlsLocked}
              readOnly={recurrenceControlsLocked}
            />
          </div>
        </div>

        <p className="text-center text-sm leading-tight italic" style={{ color: 'var(--app-text-muted)' }}>
          {cadenceSummaryText ?? cadenceSummary(form)}
        </p>
      </div>
    </div>
  )
}
