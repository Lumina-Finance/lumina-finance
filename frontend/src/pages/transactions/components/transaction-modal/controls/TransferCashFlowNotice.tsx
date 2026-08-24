import CategoryNoticeLine from '@/pages/transactions/components/transaction-modal/controls/CategoryNoticeLine'

type TransferCashFlowNoticeProps = {
  show: boolean
}

/**
 * Explains that balance adjustments never count toward cash flow and that a transfer is the right
 * way to record money actually moving between accounts
 */
export default function TransferCashFlowNotice({
  show,
}: TransferCashFlowNoticeProps) {
  return (
    <CategoryNoticeLine show={show}>
      <span>
        A balance adjustment only corrects an account&apos;s balance, so it is left out of cash
        flow. Pick a regular transfer category if money actually moved.
      </span>
    </CategoryNoticeLine>
  )
}
