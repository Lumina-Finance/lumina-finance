export const SIGNUP_FIELD_ANIMATION = {
  initial: { height: 0, opacity: 0, marginTop: 0 },
  animate: { height: 'auto', opacity: 1, marginTop: 20 },
  exit: { height: 0, opacity: 0, marginTop: 0 },
  transition: { duration: 0.25, ease: [0.25, 0.1, 0.25, 1] as const },
}

