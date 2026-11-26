import { useState, type CSSProperties, type ReactNode } from 'react'
import { CircleSlash } from 'lucide-react'
import { CollapsibleSection } from '@/components/collapsible-section/Section'
import { describeUnlinkable } from '@/components/transactions/transaction-modal/utils/refund'

interface UnlinkableCandidatesProps {
  picksRefund: boolean
  rooms: readonly number[]

  /** The rows that can't be linked, each with its reason in the shared tooltip */
  children: ReactNode
}

/**
 * The folded row at the end of the picker's list that holds the candidates that can't be linked now. Opening it lists
 * them greyed out, each with its reason in the shared tooltip
 */
export default function UnlinkableCandidates({ picksRefund, rooms, children }: UnlinkableCandidatesProps) {
  const [expanded, setExpanded] = useState(false)
  return (
    <CollapsibleSection
      icon={CircleSlash}
      label={describeUnlinkable(picksRefund, rooms)}
      expanded={expanded}
      onToggle={() => setExpanded((open) => !open)}
      // A straight divider runs the list's width above the folded row, setting what can't be linked apart from the
      // groups above. The section's own header draws above its rows. Isolating the section keeps that header under the
      // pinned search field as the list scrolls up beneath it
      className="isolate mt-2 border-t border-[var(--app-border)] pt-2"
      bodyClassName="pt-1"
      // The list eases in a box that clips at its edges, so the header draws its focus ring inside them, as the rows
      // above do. The ring then sits on the header's hover fill, so the header takes the rows' lighter fill and the
      // ring keeps 3:1 against it. Its fill and ring take the rows' rounded corners, under the divider in place of
      // its own top rule
      headerStyle={
        {
          borderTop: 'none',
          borderRadius: 'var(--radius-lg)',
          outlineOffset: 'calc(var(--app-focus-offset) * -1)',
          '--collapsible-header-hover-fill': 'var(--app-hover-soft)',
        } as CSSProperties
      }
    >
      <div role="group" aria-label="Transactions that can't be linked" data-testid="unlinkable-candidates">
        {children}
      </div>
    </CollapsibleSection>
  )
}
