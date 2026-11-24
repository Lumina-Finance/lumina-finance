import { useId } from 'react'
import type { Category } from '@/api/categories'
import type { Institution } from '@/api/institutions'
import type { RefundLinkCandidate } from '@/api/transactions'
import TransactionRow from '@/components/transactions/Row'
import { useDisabledReason } from '@/hooks/useDisabledReason'

// A picked row takes the accent fill and an accent border. The others keep a clear border so it eases in and out. The
// row inside takes the same corners, so its hover fill and focus ring match a picked row and a row with its reason
// under it
const ROW_CLASS_NAME =
  'scroll-mt-44 rounded-lg [&_.app-transaction-row]:rounded-lg transition-[background-color,box-shadow,outline-color] motion-reduce:transition-none'
const RESTING_ROW_STYLE = { boxShadow: 'inset 0 0 0 1px transparent' }
const PICKED_ROW_STYLE = { boxShadow: 'inset 0 0 0 1px var(--app-accent)' }

// The picked row rests in the accent fill and deepens it under the pointer, as a chosen option in the filter panels
// does. The row inside draws no hover fill of its own over it
const PICKED_ROW_CLASS_NAME =
  'bg-[var(--app-accent-soft)] hover:bg-[var(--app-accent-chosen-hover-fill)] [&_.app-transaction-row]:bg-transparent!'

// A row that can't be picked wears the app's standard disabled strength. The whole of the row's content fades, its
// cells and its title, whereas the row around it draws the keyboard focus ring and stays at full strength
const DISABLED_CONTENT_CLASS_NAME = '[&_[data-row-content]]:opacity-50'

// A row that can't be linked moves the row's separator below its reason. The keyboard focus ring goes around the row
// and its reason together, in place of the inner row's ring, so it never cuts through the reason
const HAS_REASON_CLASS_NAME = [
  '[&_.app-transaction-row]:[border-bottom-color:transparent]! [&_.app-transaction-row]:outline-none!',
  '[outline:var(--app-focus-outline-rest)] [outline-offset:calc(var(--app-focus-offset)*-1)]',
  'has-[[data-row-title]:focus-visible]:[outline:var(--app-focus-outline)]',
].join(' ')

// The reason under the row starts where the row's merchant name does: past the row's 0.75rem padding, its 2.125rem
// icon column and the 0.625rem gap after it
const REASON_CLASS_NAME = 'pb-2.5 pl-14 pr-3 -mt-1 text-xs'

interface LinkCandidateRowProps {
  transaction: RefundLinkCandidate
  category: Category | undefined
  accountName: string | undefined
  accountInstitution: Institution | null | undefined
  isPicked: boolean

  /** Why the row can't be linked now, written under it. Null when it can be */
  refusal: string | null
  onPick: () => void
}

/**
 * A row of the link picker. A row that can't be linked is greyed out with its reason written under it, never only in
 * a tooltip, and describes the row's button for a screen reader. A likely match carries no label saying why, since its
 * group heading says it
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
  const reasonId = useId()
  const reason = useDisabledReason(refusal, reasonId)
  return (
    <div
      className={[ROW_CLASS_NAME, isPicked && PICKED_ROW_CLASS_NAME, refusal && HAS_REASON_CLASS_NAME]
        .filter(Boolean)
        .join(' ')}
      style={{
        ...(isPicked ? PICKED_ROW_STYLE : RESTING_ROW_STYLE),
        ...(refusal && { borderBottom: '1px solid var(--app-border)' }),
      }}
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
      {refusal && (
        <p id={reasonId} className={REASON_CLASS_NAME} style={{ color: 'var(--app-text-muted)' }}>
          {refusal}
        </p>
      )}
    </div>
  )
}
