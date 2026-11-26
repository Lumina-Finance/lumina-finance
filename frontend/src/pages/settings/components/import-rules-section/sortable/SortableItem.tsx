import type { CSSProperties, ReactNode } from 'react'
import { useReducedMotion } from 'motion/react'
import { GripHandle } from '@/pages/settings/components/import-rules-section/sortable/GripHandle'
import { useSortableRow } from '@/pages/settings/components/import-rules-section/sortable/useSortableRow'

type SortableItemProps = {
  id: string

  /** Names the grip for a screen reader, such as "Move condition 2" */
  gripLabel: string

  /** Why the row can't be moved right now. While set, the grip explains itself and the row stays put */
  disabledReason?: string | null

  /**
   * What the row sits on, a card or a dialogue. A held row takes that surface as its own, so the rows beside it
   * never show through
   */
  surface: 'card' | 'dialogue'

  /** Draws the row's contents, given the grip to place where the row wants it */
  children: (grip: ReactNode) => ReactNode
}

// Whole strings, so the stylesheet finds each class. A held row is solid in the colour of the surface it sits on, the
// one a card and a dialogue are drawn in
const LIFTED_SURFACE_CLASS_NAME = {
  card: 'data-lifted:bg-[var(--app-surface-soft)]',
  dialogue: 'data-lifted:bg-[var(--app-bg)]',
} as const

/** The raised look of a held row eases in and out over the app's own duration and curve */
const LIFT_TRANSITION =
  'box-shadow var(--app-ease-duration) var(--app-ease-curve), background-color var(--app-ease-duration) var(--app-ease-curve)'

/**
 * One reorderable row of a list that isn't a table, drawn as a list item
 *
 * A row held by the mouse, a finger or the keyboard is drawn lifted: the surface of a floating thing with
 * the app's soft shadow
 */
export function SortableItem({ id, gripLabel, disabledReason, surface, children }: SortableItemProps) {
  const { rowRef, rowStyle, gripRef, gripProps, isDragging } = useSortableRow(id, Boolean(disabledReason))
  const shouldReduceMotion = useReducedMotion()

  const style: CSSProperties = { ...rowStyle }
  if (!shouldReduceMotion)
    style.transition = rowStyle.transition ? `${rowStyle.transition}, ${LIFT_TRANSITION}` : LIFT_TRANSITION

  return (
    <li
      ref={rowRef}
      style={style}
      // The lifted look reads the attribute a held row carries, so the look and the attribute can't part
      className={`rounded-lg bg-transparent [box-shadow:0_0_0_0_transparent] ${LIFTED_SURFACE_CLASS_NAME[surface]} data-lifted:[box-shadow:var(--app-shadow-soft)]`}
      data-lifted={isDragging || undefined}
    >
      {children(<GripHandle ref={gripRef} label={gripLabel} disabledReason={disabledReason} {...gripProps} />)}
    </li>
  )
}
