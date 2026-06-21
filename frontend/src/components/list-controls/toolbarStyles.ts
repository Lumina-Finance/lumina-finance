import type { CSSProperties } from 'react'
import type { Transition } from 'motion/react'
import { joinClassNames } from '@/utils/classNames'

// The collapsed filter pill matches the 44px create and search control height once its 1px glass
// border is added, so the head fixes its inner height to 42px
export const FILTER_PILL_HEAD_STYLE: CSSProperties = {
  height: 42,
  padding: '0 16px',
  gap: 8,
  fontSize: '0.9375rem',
}

// The panel grows its height on a slower curve than the cross-fade so the content settles after the
// box has finished expanding
export const FILTER_PANEL_BODY_TRANSITION: Transition = {
  height: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
  opacity: { duration: 0.26, delay: 0.05 },
}

/**
 * Builds the sticky classes that dock the list toolbar to the navigation pane line on desktop, with
 * the inline layout moving the search and actions onto one row from the medium breakpoint up
 */
export function getToolbarStickyRowClass(desktopInlineLayout: boolean): string {
  return joinClassNames(
    'sticky top-0 z-30 !mt-1 mb-1 flex flex-col gap-3 pb-1 pt-2 min-[1050px]:top-2.5 min-[1050px]:pt-2.5',
    desktopInlineLayout && 'min-[750px]:flex-row min-[750px]:items-center',
  )
}

/**
 * Returns the toolbar drop shadow. While docked at the nav line the upward shadow masks list rows
 * scrolling through the gap above the toolbar, and it drops at rest so it never covers the content
 * above the row
 */
export function getToolbarStuckShadow(isStuck: boolean): string {
  return isStuck
    ? '0 0.25rem 0 var(--app-bg), 0 -1.5rem 0 var(--app-bg)'
    : '0 0.25rem 0 var(--app-bg)'
}
