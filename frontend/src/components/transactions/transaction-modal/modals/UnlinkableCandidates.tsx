import { useState, type ReactNode } from 'react'
import { CircleSlash } from 'lucide-react'
import { CollapsibleSection } from '@/components/collapsible-section/Section'
import { describeUnlinkable } from '@/components/transactions/transaction-modal/utils/refund'

interface UnlinkableCandidatesProps {
  picksRefund: boolean
  rooms: readonly number[]

  /** The rows that can't be linked, each with its reason written under it */
  children: ReactNode
}

/**
 * The folded row at the end of the picker's list that holds the candidates that can't be linked now. Opening it lists
 * them greyed out, each with its reason in text
 */
export default function UnlinkableCandidates({ picksRefund, rooms, children }: UnlinkableCandidatesProps) {
  const [expanded, setExpanded] = useState(false)
  return (
    <CollapsibleSection
      icon={CircleSlash}
      label={describeUnlinkable(picksRefund, rooms)}
      expanded={expanded}
      onToggle={() => setExpanded((open) => !open)}
      className="mt-2"
      bodyClassName="pt-1"
    >
      <div role="group" aria-label="Transactions that can't be linked" data-testid="unlinkable-candidates">
        {children}
      </div>
    </CollapsibleSection>
  )
}
