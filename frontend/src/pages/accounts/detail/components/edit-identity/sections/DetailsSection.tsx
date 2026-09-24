import type { DropdownOption } from '@/components/dropdown/Dropdown'
import Dropdown from '@/components/dropdown/Dropdown'
import LoadFailure from '@/components/errors/LoadFailure'
import { CurrencyUnavailableTooltip } from '@/components/currency/CurrencyUnavailableTooltip'
import { useMoneyInput } from '@/hooks/useMoneyInput'
import {
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
  isCreditLimitLocked: boolean

  // Explains why the authoritative own-currency lock applies
  currencyState: CurrencyListState
  selectedCurrencySymbol: string
  // Decimal places of the account's currency, used to settle the credit limit field on blur
  creditLimitExponent: number
  taxAdvantagedCategoryOptions: DropdownOption[]
  taxAdvantagedCategoriesError: unknown
  taxAdvantagedCategoriesFailed: boolean
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
  isCreditLimitLocked,
  currencyState,
  selectedCurrencySymbol,
  creditLimitExponent,
  taxAdvantagedCategoryOptions,
  taxAdvantagedCategoriesError,
  taxAdvantagedCategoriesFailed,
  setField,
}: AccountDetailsSectionProps) {
  const creditLimitInput = useMoneyInput({
    value: form.credit_limit,
    exponent: creditLimitExponent,
    onChange: (value) => setField('credit_limit', value),
  })

  return (
    <EditModalSection number="02" title="Details">
      {canLinkTaxAdvantagedCategory && (
        <div>
          <AccountIdentityFieldLabelRow
            label="Tax-Advantaged Category"
            htmlFor={EDIT_ACCOUNT_IDENTITY_FIELD_IDS.taxAdvantagedCategory}
          />
          <Dropdown
            id={EDIT_ACCOUNT_IDENTITY_FIELD_IDS.taxAdvantagedCategory}
            options={taxAdvantagedCategoryOptions}
            value={form.tax_advantaged_category_id}
            onChange={(value) => setField('tax_advantaged_category_id', value)}
            placeholder="Select category..."
            searchable
            searchPlaceholder="Search categories..."
          />
          {/* Beside the drop-down rather than in place of the form, since the category is optional
              and the rest of the account can still be edited without it */}
          {taxAdvantagedCategoriesFailed && (
            <LoadFailure
              className="pt-3"
              error={taxAdvantagedCategoriesError}
              subject="Tax-advantaged categories"
            />
          )}
        </div>
      )}

      {isRevolving && (
        <div>
          <AccountIdentityFieldLabelRow
            htmlFor={EDIT_ACCOUNT_IDENTITY_FIELD_IDS.creditLimit}
            label={(
              <span className="inline-flex items-center gap-2">
                Credit Limit
                <CurrencyUnavailableTooltip unavailable={isCreditLimitLocked} currencyState={currencyState} label="Credit limit unavailable" />
              </span>
            )}
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
