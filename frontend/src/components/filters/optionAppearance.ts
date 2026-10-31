import type { CSSProperties } from 'react'

/**
 * Returns the accent fill, text colour, and weight that mark a selected filter option, keeping the
 * checklist rows and the reference filter rows aligned with the theme switcher and segmented control
 * selection colours
 *
 * The control that chooses which filter tab is showing no longer takes its selected look from here,
 * since it is drawn by the shared dropdown, which carries the same colours in its own styles
 *
 * A list whose rows sit straight on the page colour rather than on a filter panel passes `onPageTint`
 * for the selected text that stays readable on the tint there
 */
export function getFilterOptionStyle(selected: boolean, onPageTint = false): CSSProperties {
  return {
    color: selected ? (onPageTint ? 'var(--app-accent-on-page-tint)' : 'var(--app-accent)') : 'var(--app-text)',
    fontWeight: selected ? 500 : 400,
    background: selected ? 'var(--app-accent-soft)' : undefined,
  }
}

/** Returns the gap between option rows, one step wider for the list that shows details under each label */
export function getFilterOptionGapClass(roomy: boolean): string {
  return roomy ? 'space-y-1.5' : 'space-y-1'
}

/**
 * Returns the scroll container classes shared by the filter option lists, switching between the
 * capped desktop height and the fill height the mobile sheet gives the list, with a wider gap between
 * rows for the list that shows details under each label
 *
 * A pinned group heading sticks below the list's top padding, so rows scrolling past would show above
 * it. A grouped list takes that space as a margin outside the scrolling box instead, which keeps its
 * outer height as it was
 */
export function getFilterOptionListClass(fillHeight: boolean, roomy = false, grouped = false): string {
  const gap = getFilterOptionGapClass(roomy)
  if (grouped)
    return fillHeight ? `mt-2 min-h-12 flex-1 ${gap} overflow-auto pb-2` : `mt-2 max-h-54 ${gap} overflow-auto pb-2`
  return fillHeight ? `min-h-12 flex-1 ${gap} overflow-auto py-2` : `max-h-56 ${gap} overflow-auto py-2`
}
