import Dropdown from '@/components/Dropdown'
import IconTooltip from '@/components/IconTooltip'
import type { BudgetEditorModalErrorGetter, BudgetEditorModalFieldIds, BudgetEditorModalHandlers, BudgetEditorModalOptions, BudgetEditorModalViewState } from '@/budgets/components/budget-editor-modal/budgetEditorModalTypes'
import FieldLabelRow from '@/budgets/components/shared/FieldLabelRow'
import { formatMoneyInputLive, sanitizeMoneyInput } from '@/budgets/utils/money'

interface BudgetEditorModalScopeSectionProps {
  state: BudgetEditorModalViewState
  options: BudgetEditorModalOptions
  ids: BudgetEditorModalFieldIds
  selectedCurrencySymbol: string
  namePlaceholder?: string
  limitPlaceholder: string
  currencyReadOnly: boolean
  currencyTooltip: boolean
  limitDisabled: boolean
  showError: BudgetEditorModalErrorGetter
  handlers: BudgetEditorModalHandlers
}

/**
 * Renders budget name, currency, and limit controls for create and edit forms
 */
export default function BudgetEditorModalScopeSection({
  state,
  options,
  ids,
  selectedCurrencySymbol,
  namePlaceholder,
  limitPlaceholder,
  currencyReadOnly,
  currencyTooltip,
  limitDisabled,
  showError,
  handlers,
}: BudgetEditorModalScopeSectionProps) {
  const { form } = state
  const { currencies } = options
  const { setField, onBlur } = handlers

  return (
    <div className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-2 min-[1050px]:gap-x-3">
      <div className="flex min-h-0 flex-col items-center">
        <span className="flex h-4 shrink-0 items-center text-xs font-semibold leading-none" style={{ color: 'var(--app-accent)' }} aria-hidden>
          01
        </span>
        <span
          className="mt-1 w-px flex-1"
          style={{ backgroundColor: 'var(--app-border-strong)' }}
          aria-hidden
        />
      </div>

      <div className="min-w-0 space-y-3">
        <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>Scope</p>

        <div>
          <FieldLabelRow htmlFor={ids.name} label="Name" error={showError('name')} />
          <input
            id={ids.name}
            className={`app-input ${showError('name') ? 'app-input-error' : ''}`}
            placeholder={namePlaceholder}
            value={form.name}
            onChange={(event) => setField('name', event.target.value)}
            onBlur={() => onBlur('name')}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <FieldLabelRow
              htmlFor={ids.currency}
              label={currencyTooltip ? (
                <span className="inline-flex items-center gap-2">
                  Currency
                  <IconTooltip label="Budget currency limitation" level="important">
                    Budgets currently track only accounts in the same currency
                  </IconTooltip>
                </span>
              ) : 'Currency'}
              error={showError('currency')}
            />
            {currencyReadOnly ? (
              <input
                id={ids.currency}
                className="app-input disabled:cursor-not-allowed disabled:opacity-60"
                value={form.currency}
                disabled
                readOnly
              />
            ) : (
              <Dropdown
                id={ids.currency}
                options={currencies.map((currency) => ({
                  value: currency.id,
                  label: `${currency.id} · ${currency.name}`,
                }))}
                value={form.currency}
                onChange={(value) => setField('currency', value)}
                className={`app-input ${showError('currency') ? 'app-input-error' : ''}`}
                placeholder={currencies.length === 0 ? 'Loading currencies...' : 'Select currency...'}
                searchable
                searchPlaceholder="Search currencies..."
              />
            )}
          </div>

          <div>
            <FieldLabelRow htmlFor={ids.limit} label="Limit" error={showError('limit')} />
            <div className="relative">
              {selectedCurrencySymbol && (
                <span
                  className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2"
                  style={{ color: 'var(--app-text-subtle)' }}
                  aria-hidden
                >
                  {selectedCurrencySymbol}
                </span>
              )}
              <input
                id={ids.limit}
                className={`app-input disabled:cursor-not-allowed disabled:opacity-60 ${selectedCurrencySymbol ? 'pl-8' : ''} ${showError('limit') ? 'app-input-error' : ''}`}
                inputMode="decimal"
                placeholder={limitPlaceholder}
                value={form.limit}
                onChange={(event) => setField('limit', formatMoneyInputLive(sanitizeMoneyInput(event.target.value)))}
                onBlur={() => onBlur('limit')}
                disabled={limitDisabled}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
