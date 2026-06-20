import type { DropdownOption } from '@/components/dropdown/Dropdown'
import Dropdown from '@/components/dropdown/Dropdown'
import { EDIT_ACCOUNT_IDENTITY_FIELD_IDS } from '@/pages/accounts/detail/constants/accountDetail'
import {
  formatMoneyInputLive,
  sanitizeMoneyInput,
} from '@/utils/moneyInput'
import type {
  IdentityFieldErrors,
  IdentityFormValues,
} from '@/pages/accounts/detail/utils/identityForm'
import type { SetIdentityFormField } from '../types'
import { EditModalSection } from '../layout/Section'
import { AccountIdentityFieldLabelRow } from '../controls/FieldLabelRow'

type AccountDetailsSectionProps = {
  form: IdentityFormValues
  fieldErrors: IdentityFieldErrors
  canLinkTaxAdvantagedCategory: boolean
  isRevolving: boolean
  selectedCurrencySymbol: string
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
  selectedCurrencySymbol,
  taxAdvantagedCategoryOptions,
  setField,
}: AccountDetailsSectionProps) {
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
          <AccountIdentityFieldLabelRow htmlFor={EDIT_ACCOUNT_IDENTITY_FIELD_IDS.creditLimit} label="Credit Limit" error={fieldErrors.credit_limit} />
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
              className={`app-input ${selectedCurrencySymbol ? 'pl-8' : ''} ${fieldErrors.credit_limit ? 'app-input-error' : ''}`}
              inputMode="decimal"
              value={form.credit_limit}
              onChange={(event) => setField(
                'credit_limit',
                formatMoneyInputLive(sanitizeMoneyInput(event.target.value)),
              )}
              placeholder="Optional"
            />
          </div>
        </div>
      )}
    </EditModalSection>
  )
}
