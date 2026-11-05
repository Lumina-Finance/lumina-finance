// The app's 300ms ease. Regrouping the list moves its rows and fades its headers with it
const REGROUP_DURATION_SECONDS = 0.3
const REGROUP_EASE = [0.22, 1, 0.36, 1] as const

/**
 * Returns the transition for regrouping the account list. It swaps to the new layout at once
 * when the user prefers reduced motion
 */
export function getRegroupTransition(prefersReducedMotion: boolean | null) {
  return prefersReducedMotion ? { duration: 0 } : { duration: REGROUP_DURATION_SECONDS, ease: REGROUP_EASE }
}
