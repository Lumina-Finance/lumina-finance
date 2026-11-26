import type { Announcements } from '@dnd-kit/core'

/** What a screen reader is told about a grip before the row is picked up */
export const SORT_INSTRUCTIONS =
  'To pick up this item, press Space. Then use the arrow keys to move it, Space to drop it, or Escape to cancel.'

type Entry = {
  id: string
  label: string
}

/**
 * Words what a screen reader hears while a row is picked up, moved, dropped or put back
 *
 * Places are said from one, as a person counts them, though the app keeps them from zero
 */
export function getSortAnnouncements(entries: Entry[]): Announcements {
  const total = entries.length
  const labelOf = (id: string | number) => entries.find((entry) => entry.id === String(id))?.label ?? 'Item'
  const placeOf = (id: string | number) => entries.findIndex((entry) => entry.id === String(id)) + 1

  return {
    onDragStart: ({ active }) => `Picked up ${labelOf(active.id)}. It is number ${placeOf(active.id)} of ${total}.`,
    // Picking a row up reports it over its own place at once. A message for that would replace the pick-up
    onDragOver: ({ active, over }) =>
      over && over.id !== active.id
        ? `${labelOf(active.id)} is now over number ${placeOf(over.id)} of ${total}.`
        : undefined,
    onDragEnd: ({ active, over }) =>
      over && over.id !== active.id
        ? `Dropped ${labelOf(active.id)} at number ${placeOf(over.id)} of ${total}.`
        : `Dropped ${labelOf(active.id)}. It stays at number ${placeOf(active.id)} of ${total}.`,
    onDragCancel: ({ active }) => `Cancelled. ${labelOf(active.id)} stays at number ${placeOf(active.id)} of ${total}.`,
  }
}
