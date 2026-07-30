import Dropdown from '@/components/dropdown/Dropdown'
import IconTooltip from '@/components/tooltips/IconTooltip'
import { useMoneyInput } from '@/hooks/useMoneyInput'
import type { BudgetEditorModalErrorGetter, BudgetEditorModalFieldIds, BudgetEditorModalHandlers, BudgetEditorModalOptions, BudgetEditorModalViewState } from '@/pages/budgets/components/budget-editor-modal/types'
import BudgetEditorFieldLabelRow from '@/pages/budgets/components/shared/EditorFieldLabelRow'
import { getCurrencyExponent, getMoneyPlaceholder } from '@/utils/moneyInput'
import {
  CURRENCY_AMOUNT_NOTICE,
  CURRENCY_LIST_LOADING,
  CURRENCY_LIST_NOTICE,
  type CurrencyListState,
} from '@/utils/currencyStatus'

interface BudgetEditorModalScopeSectionProps {
  state: BudgetEditorModalViewState
  options: BudgetEditorModalOptions
  ids: BudgetEditorModalFieldIds
  selectedCurrencySymbol: string
  namePlaceholder?: string

  // Stands in for the amount format when the field cannot take a limit at all, such as a budget
  // with no period yet
  limitPlaceholder?: string
  currencyReadOnly: boolean
  currencyTooltip: boolean
  limitDisabled: boolean

  // Stands the limit down unless the currency table is in hand, since its decimal places are the only way
  // to read or write the stored amount, and says which of the two reasons applies
  currencyState: CurrencyListState

  // Locks every editable field while the budget is archived so only the archive toggle stays live
  fieldsLocked: boolean
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
  currencyState,
  fieldsLocked,
  showError,
  handlers,
}: BudgetEditorModalScopeSectionProps) {
  const { form } = state
  const { currencies } = options
  const { setField, onBlur } = handlers
  const isLimitLocked = currencyState !== 'ready'
  const limitExponent = getCurrencyExponent(currencies, form.currency)
  const limitInput = useMoneyInput({
    value: form.limit,
    exponent: limitExponent,
    onChange: (value) => setField('limit', value),
    onBlur: () => onBlur('limit'),
  })

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
          <BudgetEditorFieldLabelRow htmlFor={ids.name} label="Name" error={showError('name')} />
          <input
            id={ids.name}
            className={`app-input disabled:cursor-not-allowed disabled:opacity-60 ${showError('name') ? 'app-input-error' : ''}`}
            placeholder={namePlaceholder}
            value={form.name}
            onChange={(event) => setField('name', event.target.value)}
            onBlur={() => onBlur('name')}
            disabled={fieldsLocked}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <BudgetEditorFieldLabelRow
              htmlFor={ids.currency}
              label={currencyTooltip || isLimitLocked ? (
                <span className="inline-flex items-center gap-2">
                  Currency
                  {currencyTooltip && (
                    <IconTooltip label="Budget currency limitation" level="important">
                      Budgets currently track only accounts in the same currency
                    </IconTooltip>
                  )}
                  {currencyState === 'loading' && (
                    <IconTooltip label="Loading currencies" modalFieldTabStop>
                      {CURRENCY_LIST_LOADING}
                    </IconTooltip>
                  )}
                  {currencyState === 'unavailable' && (
                    <IconTooltip label="Currency list unavailable" level="important" modalFieldTabStop>
                      {CURRENCY_LIST_NOTICE}
                    </IconTooltip>
                  )}
                </span>
              ) : 'Currency'}
              error={showError('currency')}
            />
            {currencyReadOnly ? (
              <input
                id={ids.currency}
                className="app-input disabled:cursor-not-allowed disabled:opacity-60"
                value={form.currency}
                placeholder={currencyState === 'loading' ? CURRENCY_LIST_LOADING : undefined}
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
            <BudgetEditorFieldLabelRow
              htmlFor={ids.limit}
              label={isLimitLocked ? (
                <span className="inline-flex items-center gap-2">
                  Limit
                  {currencyState === 'loading' ? (
                    <IconTooltip label="Loading currencies" modalFieldTabStop>
                      {CURRENCY_LIST_LOADING}
                    </IconTooltip>
                  ) : (
                    <IconTooltip label="Limit unavailable" level="important" modalFieldTabStop>
                      {CURRENCY_AMOUNT_NOTICE}
                    </IconTooltip>
                  )}
                </span>
              ) : 'Limit'}
              error={showError('limit')}
            />
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
                placeholder={isLimitLocked ? undefined : limitPlaceholder ?? getMoneyPlaceholder(limitExponent)}
                disabled={limitDisabled || fieldsLocked || isLimitLocked}
                {...limitInput}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
