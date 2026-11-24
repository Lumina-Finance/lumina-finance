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
      // The section's own header pins as it scrolls. Isolating the section keeps that header under the pinned search
      // field as the list scrolls up beneath it
      className="isolate mt-2"
      bodyClassName="pt-1"
      // The list eases in a box that clips at its edges, so the header draws its focus ring inside them, as the rows
      // above do
      headerStyle={{ outlineOffset: 'calc(var(--app-focus-offset) * -1)' }}
    >
      <div role="group" aria-label="Transactions that can't be linked" data-testid="unlinkable-candidates">
        {children}
      </div>
    </CollapsibleSection>
  )
}
