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

/**
 * Returns the scroll container classes shared by the filter option lists, switching between the
 * capped desktop height and the fill height the mobile sheet gives the list
 */
export function getFilterOptionListClass(fillHeight: boolean): string {
  return fillHeight
    ? 'min-h-12 flex-1 space-y-1 overflow-auto py-2'
    : 'max-h-56 space-y-1 overflow-auto py-2'
}
