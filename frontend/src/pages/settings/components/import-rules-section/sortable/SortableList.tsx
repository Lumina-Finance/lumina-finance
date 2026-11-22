import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { SortLandingContext } from '@/pages/settings/components/import-rules-section/sortable/useSortableRow'
import {
  getSortAnnouncements,
  SORT_INSTRUCTIONS,
} from '@/pages/settings/components/import-rules-section/utils/announcements'

/** The rows only ever move up and down, so a drag keeps its place along the row */
const keepToColumn: Modifier = ({ transform }) => ({ ...transform, x: 0 })

/**
 * How long the rows wait for the order a drop asked for. A move the list never shows, such as one refused, then
 * doesn't hold the rows in the look the drag left them in
 */
const LANDING_LIMIT_MS = 400

export type SortableEntry = {
  id: string

  /** What a screen reader hears the item called, such as "Condition 2" or a rule's name */
  label: string
}

type SortableListProps = {
  entries: SortableEntry[]

  /** Called with where the item was and where it was dropped, both counted from zero */
  onMove: (from: number, to: number) => void
  children: ReactNode
}

/**
 * Lets the rows inside it be reordered by a grip, with a mouse, a finger or the keyboard
 *
 * The keyboard picks a row up with Space, moves it with the arrow keys, drops it with Space and puts it
 * back with Escape, and a live region says where the row is as it moves. The region sits inside this
 * list rather than on the page, so it is read while a dialogue holds the rest of the page back
 */
export function SortableList({ entries, onMove, children }: SortableListProps) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const sensors = useSensors(
    // A short drag, so a press on the grip that never moves is not a pick-up
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const ids = useMemo(() => entries.map((entry) => entry.id), [entries])
  const orderKey = useMemo(() => JSON.stringify(ids), [ids])
  const announcements = useMemo<Announcements>(() => getSortAnnouncements(entries), [entries])
  // The order the rows had when a drop asked for a move. The move has landed once the order is another
  const [orderBeforeMove, setOrderBeforeMove] = useState<string | null>(null)
  const isLanding = orderBeforeMove !== null && orderBeforeMove === orderKey

  useEffect(() => {
    if (orderBeforeMove === null) return undefined
    const timeoutId = window.setTimeout(() => setOrderBeforeMove(null), LANDING_LIMIT_MS)
    return () => window.clearTimeout(timeoutId)
  }, [orderBeforeMove])

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from === -1 || to === -1) return
    setOrderBeforeMove(orderKey)
    onMove(from, to)
  }

  return (
    <div ref={setContainer}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[keepToColumn]}
        onDragEnd={handleDragEnd}
        accessibility={{
          announcements,
          screenReaderInstructions: { draggable: SORT_INSTRUCTIONS },
          container: container ?? undefined,
        }}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <SortLandingContext value={isLanding}>{children}</SortLandingContext>
        </SortableContext>
      </DndContext>
    </div>
  )
}
