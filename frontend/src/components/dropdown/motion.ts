/**
 * How the drop-down moves
 *
 * The box's own opening is a CSS transition in tailwind.css, since it animates to a height nobody
 * measured. What is here is everything driven by motion instead: the chevron and the press. Editing
 * these numbers is all that changing the feel of either takes.
 */

// Gently damped, settling with little overshoot. The same spring the insights range control and the
// toolbar filter pill use, so the three read as one family
export const DROPDOWN_SPRING = { type: 'spring', stiffness: 420, damping: 34, mass: 0.9 } as const

// How far the box sinks under a press, as a proportion of its own size. Slighter than the range
// controls take, because a field in a form is pressed far more often than a control on a toolbar
export const DROPDOWN_PRESS_SCALE = 0.985

export const DROPDOWN_INSTANT_TRANSITION = { duration: 0 } as const

// Overshoots and settles back, which is what gives the contents their bounce as they arrive
const RISE_EASE = [0.34, 1.6, 0.5, 1] as const

// How far the contents start below where they settle, so they rise into the opening box
export const DROPDOWN_RISE_DISTANCE = 8

// Matched to the box's own opening in tailwind.css, so the two settle together. Running longer leaves
// the contents still rising after the box has stopped, which reads as a second animation
export const DROPDOWN_RISE_TRANSITION = {
  opacity: { duration: 0.26 },
  y: { duration: 0.45, ease: RISE_EASE },
} as const
