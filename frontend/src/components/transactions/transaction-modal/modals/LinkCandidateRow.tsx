import type { Category } from '@/api/categories'
import type { Institution } from '@/api/institutions'
import type { RefundLinkCandidate } from '@/api/transactions'
import TransactionRow from '@/components/transactions/Row'
import { useDisabledReason } from '@/hooks/useDisabledReason'

// A picked row takes the accent fill and an accent border. The others keep a clear border so it eases in and out. The
// row inside takes the same corners, so its hover fill and focus ring match a picked row
const ROW_CLASS_NAME =
  'scroll-mt-44 rounded-lg [&_.app-transaction-row]:rounded-lg transition-[background-color,box-shadow] motion-reduce:transition-none'
const RESTING_ROW_STYLE = { boxShadow: 'inset 0 0 0 1px transparent' }
const PICKED_ROW_STYLE = { boxShadow: 'inset 0 0 0 1px var(--app-accent)' }

// The picked row rests in the accent fill and deepens it under the pointer, as a chosen option in the filter panels
// does. The row inside draws no hover fill of its own over it
const PICKED_ROW_CLASS_NAME =
  'bg-[var(--app-accent-soft)] hover:bg-[var(--app-accent-chosen-hover-fill)] [&_.app-transaction-row]:bg-transparent!'

// A row that can't be picked wears the app's standard disabled strength. The whole of the row's content fades, its
// cells and its title, whereas the row around it draws the keyboard focus ring and stays at full strength
const DISABLED_CONTENT_CLASS_NAME = '[&_[data-row-content]]:opacity-50'

interface LinkCandidateRowProps {
  transaction: RefundLinkCandidate
  category: Category | undefined
  accountName: string | undefined
  accountInstitution: Institution | null | undefined
  isPicked: boolean

  /** Why the row can't be linked now, shown in the shared tooltip like a greyed out button's. Null when it can be */
  refusal: string | null
  onPick: () => void
}

/**
 * A row of the link picker. A row that can't be linked is greyed out, and its reason is given by the tooltip on hover,
 * keyboard focus and tap and by its description for a screen reader, never written into the row. A likely match
 * carries no label saying why, since its group heading says it
 */
export default function LinkCandidateRow({
  transaction,
  category,
  accountName,
  accountInstitution,
  isPicked,
  refusal,
  onPick,
}: LinkCandidateRowProps) {
  const reason = useDisabledReason(refusal)
  return (
    <div
      className={isPicked ? `${ROW_CLASS_NAME} ${PICKED_ROW_CLASS_NAME}` : ROW_CLASS_NAME}
      style={isPicked ? PICKED_ROW_STYLE : RESTING_ROW_STYLE}
      data-testid="link-candidate"
      data-picked={isPicked ? 'true' : undefined}
      data-refused={refusal ? 'true' : undefined}
    >
      <div className={refusal ? DISABLED_CONTENT_CLASS_NAME : undefined}>
        <TransactionRow
          transaction={transaction}
          currency={transaction.currency}
          category={category}
          accountName={accountName}
          accountInstitution={accountInstitution}
          skipEnterAnimation
          phoneLayout
          pressed={isPicked}
          disabledReason={reason}
          onOpen={onPick}
        />
      </div>
      {reason.tooltip}
    </div>
  )
}
