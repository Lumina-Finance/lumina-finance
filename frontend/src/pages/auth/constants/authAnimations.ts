export const SIGNUP_FIELD_ANIMATION = {
  initial: { height: 0, opacity: 0, marginTop: 0 },
  animate: { height: 'auto', opacity: 1, marginTop: 20 },
  exit: { height: 0, opacity: 0, marginTop: 0 },
  transition: { duration: 0.25, ease: [0.25, 0.1, 0.25, 1] as const },
}

// The login form's "Forgot password?" link slides like the signup fields. Its focus ring reaches 4px past it
// and the sliding box clips, so the link's row has 4px of padding for the ring.
// The padding is in px like the ring, so it stays 4px at larger text sizes.
// The box's 4px side margins, its 16px top margin and its -4px bottom margin cancel that padding.
// The link stays where a 20px top margin put it
export const FORGOT_LINK_ANIMATION = {
  initial: { height: 0, opacity: 0, marginTop: 0, marginBottom: 0 },
  animate: { height: 'auto', opacity: 1, marginTop: 16, marginBottom: -4 },
  exit: { height: 0, opacity: 0, marginTop: 0, marginBottom: 0 },
  transition: SIGNUP_FIELD_ANIMATION.transition,
}

// Cross-fade with a small slide for when one auth view swaps for another, such as the forgot
// form giving way to its confirmation or the reset form to its success message
export const AUTH_VIEW_TRANSITION = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.2, ease: [0.25, 0.1, 0.25, 1] as const },
}

