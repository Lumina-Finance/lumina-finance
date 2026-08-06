/**
 * How the drop-down moves
 *
 * The box's height is a CSS transition in tailwind.css, since it animates to a height nobody
 * measured. What is here is everything driven by motion instead: the chevron, the press, the width
 * the box grows into, and the contents rising inside it as it opens. Editing these numbers is all
 * that changing the feel of any of them takes.
 */

// Gently damped, settling with little overshoot. The same spring the insights range control and the
// toolbar filter pill use, so the three read as one family
export const DROPDOWN_SPRING = { type: 'spring', stiffness: 420, damping: 34, mass: 0.9 } as const

// How far the box sinks under a press, as a proportion of its own size. Slighter than the range
// controls take, because a field in a form is pressed far more often than a control on a toolbar
export const DROPDOWN_PRESS_SCALE = 0.985

export const DROPDOWN_INSTANT_TRANSITION = { duration: 0 } as const

// The same curve as --app-dropdown-ease in tailwind.css, which is what the box's own height uses, so
// the contents and the box they arrive in are on one motion. It must not overshoot: the rise is only
// a few pixels, so going past and coming back moves the text by under a pixel, which is too small to
// read as a bounce and lands as the options settling twice
const RISE_EASE = [0.22, 1, 0.36, 1] as const

// How far the contents start below where they settle, so they rise into the opening box
export const DROPDOWN_RISE_DISTANCE = 8

// Matched to the box's own opening in tailwind.css, so the two settle together. Running longer leaves
// the contents still rising after the box has stopped, which reads as a second animation
export const DROPDOWN_RISE_TRANSITION = {
  opacity: { duration: 0.26 },
  y: { duration: 0.45, ease: RISE_EASE },
} as const

// Matched to the box's own closing, which is quicker than its opening for the reason given beside
// --app-dropdown-close-duration in tailwind.css
export const DROPDOWN_SINK_TRANSITION = {
  opacity: { duration: 0.14 },
  y: { duration: 0.2 },
} as const

// The box giving back the room it grew into, on its own height's closing timing and curve so the
// two are done together. Widening is DROPDOWN_SPRING, which is what the insights range control and
// the toolbar filter pill both give their own width
export const DROPDOWN_NARROW_TRANSITION = { duration: 0.2, ease: RISE_EASE } as const
