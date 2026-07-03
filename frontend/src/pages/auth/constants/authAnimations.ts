export const SIGNUP_FIELD_ANIMATION = {
  initial: { height: 0, opacity: 0, marginTop: 0 },
  animate: { height: 'auto', opacity: 1, marginTop: 20 },
  exit: { height: 0, opacity: 0, marginTop: 0 },
  transition: { duration: 0.25, ease: [0.25, 0.1, 0.25, 1] as const },
}

// Cross-fade with a small slide for when one auth view swaps for another, such as the forgot
// form giving way to its confirmation or the reset form to its success message
export const AUTH_VIEW_TRANSITION = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.2, ease: [0.25, 0.1, 0.25, 1] as const },
}

