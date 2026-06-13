import type { Institution } from '@/api/institutions'
import type { Currency } from '@/api/currency'
import type { TaxAdvantagedCategory } from '@/api/taxAdvantagedCategories'
import type { DropdownOption } from '@/components/Dropdown'

/**
 * Builds the currency selector labels without leaking formatting details into the modal component
 */
export function buildCreateAccountCurrencyOptions(currencies: Currency[]): DropdownOption[] {
  return currencies.map((currency) => ({
    value: currency.id,
    label: `${currency.id} — ${currency.name} (${currency.symbol})`,
  }))
}

/**
 * Adds the explicit empty institution option before user-created institutions
 */
export function buildCreateAccountInstitutionOptions(institutions: Institution[]): DropdownOption[] {
  return [
    { value: '', label: 'None' },
    ...institutions.map((institution) => ({ value: institution.id, label: institution.name })),
  ]
}

/**
 * Shows only top-level tax-advantaged categories matching the selected account currency
 */
export function buildCreateAccountTaxPlanOptions(
  taxAdvantagedCategories: TaxAdvantagedCategory[],
  currency: string,
): DropdownOption[] {
  return [
    { value: '', label: 'None' },
    ...taxAdvantagedCategories
      .filter((category) => category.group_id === null && category.currency === currency)
      .map((category) => ({ value: category.id, label: category.name })),
  ]
}
