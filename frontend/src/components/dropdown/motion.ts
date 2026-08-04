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
