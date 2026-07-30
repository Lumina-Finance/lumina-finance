import type { DropdownOption } from '@/components/dropdown/Dropdown'
import Dropdown from '@/components/dropdown/Dropdown'
import IconTooltip from '@/components/tooltips/IconTooltip'
import { useMoneyInput } from '@/hooks/useMoneyInput'
import {
  CURRENCY_AMOUNT_NOTICE,
  CURRENCY_LIST_LOADING,
  type CurrencyListState,
} from '@/utils/currencyStatus'
import { EDIT_ACCOUNT_IDENTITY_FIELD_IDS } from '@/pages/accounts/detail/constants/accountDetail'
import type {
  IdentityFieldErrors,
  IdentityFormValues,
} from '@/pages/accounts/detail/utils/identityForm'
import type { SetIdentityFormField } from '@/pages/accounts/detail/components/edit-identity/types'
import { EditModalSection } from '@/pages/accounts/detail/components/edit-identity/layout/Section'
import { AccountIdentityFieldLabelRow } from '@/pages/accounts/detail/components/edit-identity/controls/FieldLabelRow'

type AccountDetailsSectionProps = {
  form: IdentityFormValues
  fieldErrors: IdentityFieldErrors
  canLinkTaxAdvantagedCategory: boolean
  isRevolving: boolean

  // Stands the credit limit down unless the currency table is in hand, since its decimal places are the
  // only way to read or write the stored amount, and says which of the two reasons applies
  currencyState: CurrencyListState
  selectedCurrencySymbol: string
  // Decimal places of the account's currency, used to settle the credit limit field on blur
  creditLimitExponent: number
  taxAdvantagedCategoryOptions: DropdownOption[]
  setField: SetIdentityFormField
}

/**
 * Renders optional account details that only apply to specific account kinds
 */
export function AccountDetailsSection({
  form,
  fieldErrors,
  canLinkTaxAdvantagedCategory,
  isRevolving,
  currencyState,
  selectedCurrencySymbol,
  creditLimitExponent,
  taxAdvantagedCategoryOptions,
  setField,
}: AccountDetailsSectionProps) {
  const isCreditLimitLocked = currencyState !== 'ready'
  const creditLimitInput = useMoneyInput({
    value: form.credit_limit,
    exponent: creditLimitExponent,
    onChange: (value) => setField('credit_limit', value),
  })

  return (
    <EditModalSection number="02" title="Details">
      {canLinkTaxAdvantagedCategory && (
        <div>
          <AccountIdentityFieldLabelRow label="Tax-Advantaged Category" />
          <Dropdown
            id={EDIT_ACCOUNT_IDENTITY_FIELD_IDS.taxAdvantagedCategory}
            options={taxAdvantagedCategoryOptions}
            value={form.tax_advantaged_category_id}
            onChange={(value) => setField('tax_advantaged_category_id', value)}
            placeholder="Select category..."
            searchable
            searchPlaceholder="Search categories..."
          />
        </div>
      )}

      {isRevolving && (
        <div>
          <AccountIdentityFieldLabelRow
            htmlFor={EDIT_ACCOUNT_IDENTITY_FIELD_IDS.creditLimit}
            label={isCreditLimitLocked ? (
              <span className="inline-flex items-center gap-2">
                Credit Limit
                {currencyState === 'loading' ? (
                  <IconTooltip label="Loading currencies" modalFieldTabStop>
                    {CURRENCY_LIST_LOADING}
                  </IconTooltip>
                ) : (
                  <IconTooltip label="Credit limit unavailable" level="important" modalFieldTabStop>
                    {CURRENCY_AMOUNT_NOTICE}
                  </IconTooltip>
                )}
              </span>
            ) : 'Credit Limit'}
            error={fieldErrors.credit_limit}
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
              id={EDIT_ACCOUNT_IDENTITY_FIELD_IDS.creditLimit}
              className={`app-input disabled:cursor-not-allowed disabled:opacity-60 ${selectedCurrencySymbol ? 'pl-8' : ''} ${fieldErrors.credit_limit ? 'app-input-error' : ''}`}
              placeholder="Optional"
              disabled={isCreditLimitLocked}
              {...creditLimitInput}
            />
          </div>
        </div>
      )}
    </EditModalSection>
  )
}
