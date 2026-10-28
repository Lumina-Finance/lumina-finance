import type { CSSProperties } from 'react'

/**
 * The fill and border of the compact fields these dialogues draw from utilities rather than `app-input`,
 * which turn red while the form rejects what they hold
 */
export function getCompactFieldFrameStyle(hasError: boolean): CSSProperties {
  return hasError
    ? { background: 'var(--app-negative-soft)', borderColor: 'var(--app-negative-border)' }
    : { background: 'color-mix(in srgb, var(--app-input-bg) 55%, var(--app-bg))' }
}
