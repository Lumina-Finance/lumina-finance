import type { TaxPlanFormState } from '@/pages/settings/components/tax-advantaged/types'
import type {
  CategoryDetailsField,
  CreateCategoryField,
} from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/modalFieldIds'
import { isValidMoneyInput } from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/utils/categoryUtils'
import type { FieldProblems } from '@/utils/refusedSubmit'

/**
 * What is missing or wrong in the Create category form, by field, before its values are converted to
 * minor units
 *
 * @param form - The draft being created
 * @param selectedCurrency - The currency in use, which falls back to the profile's when the draft has none
 */
export function getCreateCategoryProblems(
  form: TaxPlanFormState,
  selectedCurrency: string,
): FieldProblems<CreateCategoryField> {
  const problems: FieldProblems<CreateCategoryField> = {}
  if (!form.name.trim()) problems.name = 'Name is required'
  if (!selectedCurrency) problems.currency = 'Select a currency'
  if (!isValidMoneyInput(form.lifetime_contribution_limit)) {
    problems.lifetimeContributionLimit = 'Lifetime contribution limit must be zero or higher'
  }
  if (!isValidMoneyInput(form.accrued_contributions)) {
    problems.accruedContributions = 'Accrued contributions must be zero or higher'
  }
  return problems
}

/**
 * What is missing or wrong in the Category details form, by field, before its values are sent as
 * minor units
 */
export function getCategoryDetailsProblems(form: TaxPlanFormState): FieldProblems<CategoryDetailsField> {
  const problems: FieldProblems<CategoryDetailsField> = {}
  if (!form.name.trim()) problems.name = 'Name is required'
  if (!isValidMoneyInput(form.lifetime_contribution_limit)) {
    problems.lifetimeLimit = 'Lifetime limit must be zero or higher'
  }
  if (!isValidMoneyInput(form.accrued_contributions)) {
    problems.openingUsage = 'Opening usage must be zero or higher'
  }
  return problems
}
