import type { Currency } from '@/api/currency'
import type {
  TaxAdvantagedCategory,
  TaxAdvantagedCategoryLimit,
} from '@/api/tax-advantaged-categories'
import type {
  TaxPlanLimitDraftState,
  TaxPlanLimitFormState,
} from '@/pages/settings/components/tax-advantaged/types'
import type { LimitField } from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/modalFieldIds'
import {
  fromMinorUnits,
  isValidMoneyInput,
  toMinorUnits,
} from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/utils/categoryUtils'
import type { FieldProblems } from '@/utils/refusedSubmit'

/**
 * Creates a blank annual limit form for the supplied tax year
 */
export function createEmptyLimitForm(year: number): TaxPlanLimitFormState {
  return {
    year: String(year),
    contribution_limit: '',
    withdrawal_limit: '',
    accrued_contributions: '',
    accrued_withdrawals: '',
  }
}

/**
 * Builds the visible annual limit draft from saved data plus local edits
 */
export function getLimitDraft(
  year: number,
  limits: TaxAdvantagedCategoryLimit[],
  pendingDeletedLimit: TaxAdvantagedCategoryLimit | null,
  limitDrafts: Record<number, Partial<TaxPlanLimitDraftState>>,
  currencies: Currency[],
  plan: TaxAdvantagedCategory,
): TaxPlanLimitDraftState {
  const limit = limits.find((row) => row.year === year)
    ?? (pendingDeletedLimit?.year === year ? pendingDeletedLimit : undefined)

  return {
    contribution_limit: limitDrafts[year]?.contribution_limit
      ?? fromMinorUnits(limit?.contribution_limit ?? null, currencies, plan.currency),
    withdrawal_limit: limitDrafts[year]?.withdrawal_limit
      ?? fromMinorUnits(limit?.withdrawal_limit ?? null, currencies, plan.currency),
    accrued_contributions: limitDrafts[year]?.accrued_contributions
      ?? fromMinorUnits(limit?.accrued_contributions ?? null, currencies, plan.currency),
    accrued_withdrawals: limitDrafts[year]?.accrued_withdrawals
      ?? fromMinorUnits(limit?.accrued_withdrawals ?? null, currencies, plan.currency),
  }
}

/**
 * Compares the annual limit draft against the persisted minor-unit values
 */
export function isLimitDirty(
  year: number,
  limits: TaxAdvantagedCategoryLimit[],
  pendingDeletedLimit: TaxAdvantagedCategoryLimit | null,
  limitDrafts: Record<number, Partial<TaxPlanLimitDraftState>>,
  currencies: Currency[],
  plan: TaxAdvantagedCategory,
) {
  const limit = limits.find((row) => row.year === year)
    ?? (pendingDeletedLimit?.year === year ? pendingDeletedLimit : undefined)
  if (!limit) return false

  const draft = getLimitDraft(year, limits, pendingDeletedLimit, limitDrafts, currencies, plan)

  return toMinorUnits(draft.contribution_limit, currencies, plan.currency) !== limit.contribution_limit
    || toMinorUnits(draft.withdrawal_limit, currencies, plan.currency) !== limit.withdrawal_limit
    || (toMinorUnits(draft.accrued_contributions, currencies, plan.currency) ?? 0) !== limit.accrued_contributions
    || (toMinorUnits(draft.accrued_withdrawals, currencies, plan.currency) ?? 0) !== limit.accrued_withdrawals
}

/**
 * What is missing or wrong in an annual limit's amounts, by field. The year of an existing limit is
 * fixed, so only the add form asks for one
 */
export function getLimitAmountProblems(draft: TaxPlanLimitDraftState): FieldProblems<LimitField> {
  const problems: FieldProblems<LimitField> = {}
  if (!isValidMoneyInput(draft.contribution_limit, true)) {
    problems.contribution_limit = 'Limit is required'
  }
  if (!isValidMoneyInput(draft.accrued_contributions)) {
    problems.accrued_contributions = 'Opening contributions must be zero or higher'
  }
  if (!isValidMoneyInput(draft.withdrawal_limit)) {
    problems.withdrawal_limit = 'Withdrawal limit must be zero or higher'
  }
  if (!isValidMoneyInput(draft.accrued_withdrawals)) {
    problems.accrued_withdrawals = 'Opening withdrawals must be zero or higher'
  }
  return problems
}

/**
 * What is missing or wrong in the add-year form, by field
 */
export function getNewLimitProblems(
  form: TaxPlanLimitFormState,
  limits: TaxAdvantagedCategoryLimit[],
): FieldProblems<LimitField> {
  const problems = getLimitAmountProblems(form)
  const year = Number.parseInt(form.year, 10)
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    problems.year = 'Year must be between 1900 and 2100'
  } else if (limits.some((limit) => limit.year === year)) {
    problems.year = `A limit for ${year} already exists`
  }
  return problems
}
