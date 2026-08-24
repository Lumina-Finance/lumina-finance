import type { Category } from '@/api/categories'
import { CREDIT_CARD_PAYMENT_CATEGORY_NAME, DEBT_PAYMENT_CATEGORY_NAME } from '@/utils/transfers'

export interface CreditRepaymentSteer {
  /** Whether to show the line asking the user to check that the payment really is an expense */
  show: boolean

  /** Category the offered switch sets, or null when no switch is offered */
  switchTargetId: string | null
}

/**
 * Reports whether the chosen category may be recording a credit repayment as an expense, and which
 * category the offered switch sets
 *
 * Both categories are matched by name and the system flag, the way Balance Adjustment already is,
 * so a personal category sharing either name is left alone. The whole decision lives here rather
 * than in the component, so every case it has to get right is reachable from a test
 *
 * @param selectedCategory Category currently chosen on the form, if any
 * @param categories Every category the user can pick from
 * @param readOnly Whether the modal is showing a transaction that cannot be changed
 */
export function getCreditRepaymentSteer(
  selectedCategory: Category | undefined,
  categories: Category[],
  readOnly: boolean,
): CreditRepaymentSteer {
  const isDebtPayment = !!selectedCategory?.is_system
    && selectedCategory.name === DEBT_PAYMENT_CATEGORY_NAME
  if (!isDebtPayment) return { show: false, switchTargetId: null }

  // A read-only transaction still explains itself, but there is nothing to switch it to
  if (readOnly) return { show: true, switchTargetId: null }

  const creditCardPayment = categories.find(
    (category) => category.is_system && category.name === CREDIT_CARD_PAYMENT_CATEGORY_NAME,
  )
  return { show: true, switchTargetId: creditCardPayment?.id ?? null }
}
