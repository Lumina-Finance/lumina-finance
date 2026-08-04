/**
 * The open and close timing of the drop-down panel
 *
 * Separate from the look in tailwind.css because these values drive a motion transition rather than
 * a CSS one, and separate from the placement geometry in position.ts. Editing the numbers here is
 * all that changing the feel of the animation takes.
 */

// Eases out hard at the start and settles flat, so the list arrives quickly and stops without a bounce
const PANEL_EASE = [0.22, 1, 0.36, 1] as const

export const DROPDOWN_PANEL_OPEN_TRANSITION = {
  height: { duration: 0.32, ease: PANEL_EASE },
  opacity: { duration: 0.18 },
} as const

// Closing is quicker than opening, so a menu dismissed by a choice is out of the way before the
// change it made lands on the field behind it
export const DROPDOWN_PANEL_CLOSE_TRANSITION = {
  height: { duration: 0.18, ease: PANEL_EASE },
  opacity: { duration: 0.12 },
} as const

export const DROPDOWN_INSTANT_TRANSITION = { duration: 0 } as const
