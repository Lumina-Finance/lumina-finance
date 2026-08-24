import { CircleHelp } from 'lucide-react'
import IconTooltip from '@/components/tooltips/IconTooltip'
import CategoryNoticeLine from '@/pages/transactions/components/transaction-modal/controls/CategoryNoticeLine'

type CreditRepaymentNoticeProps = {
  show: boolean

  // Sets the category to Credit Card Payment. Left out where the modal is read-only or that
  // category has not loaded, and the button is then not rendered at all
  onUseCreditCardPayment?: () => void
}

/**
 * Asks the user to check that a payment filed under Debt Payment really is an expense, with the
 * reasoning behind the question in a tooltip and the common correction as a button
 */
export default function CreditRepaymentNotice({
  show,
  onUseCreditCardPayment,
}: CreditRepaymentNoticeProps) {
  return (
    <CategoryNoticeLine show={show}>
      <span className="inline-flex items-center gap-1">
        Make sure this payment is really an expense.
        <IconTooltip
          label="When a debt payment is not an expense"
          icon={CircleHelp}
          placement="bottom"
          widthClassName="w-72"
          size={13}
          iconColor="var(--app-warning-text)"
          modalFieldTabStop
        >
          Purchases on a credit card, line of credit or HELOC were already recorded as expenses
          when you made them. Recording the repayment (excluding interest charges) as an expense
          counts that spending twice, so use a transfer category instead. Debt Payment is for
          repaying something you do not own until it is paid in full, such as a car loan or a
          mortgage.
        </IconTooltip>
      </span>
      {onUseCreditCardPayment && (
        <button
          type="button"
          className="font-medium underline underline-offset-2"
          style={{ color: 'var(--app-accent)' }}
          onClick={onUseCreditCardPayment}
        >
          Use Credit Card Payment
        </button>
      )}
    </CategoryNoticeLine>
  )
}
