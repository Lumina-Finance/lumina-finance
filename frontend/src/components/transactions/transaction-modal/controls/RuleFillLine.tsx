import CategoryNoticeLine from '@/components/transactions/transaction-modal/controls/CategoryNoticeLine'
import type { RuleFillLine as RuleFillLineContent } from '@/components/transactions/transaction-modal/utils/ruleFill'

/**
 * The line beneath a field of a bank item's form that says an import rule filled it in, or why one
 * couldn't. It opens and closes with the field's state, so a line is gone once the person changes the
 * field it describes
 */
export default function RuleFillLine({ line }: { line: RuleFillLineContent | null }) {
  return (
    <CategoryNoticeLine show={line !== null} tone={line?.tone === 'left-out' ? 'warning' : 'muted'}>
      <span>{line?.text}</span>
    </CategoryNoticeLine>
  )
}
