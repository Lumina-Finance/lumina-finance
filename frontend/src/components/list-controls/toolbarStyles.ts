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

// One half of a direction flip, played as the body pulls back into the pill and again as it comes
// out the other side. Faster than opening, since replaying that timing twice would leave the panel
// off screen for most of a second while the scroll that forced the flip carries on
export const FILTER_PANEL_FLIP_TRANSITION: Transition = {
  height: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
  opacity: { duration: 0.14 },
}

// Lightly damped spring shared by the account and transaction filter glass panels so both settle
// with the same feel
export const FILTER_GLASS_SPRING = { type: 'spring', stiffness: 420, damping: 34, mass: 0.9 } as const

/**
 * Builds the search field's responsive wrapper classes: room for the fixed mobile navigation toggle
 * while the mobile search row is stuck, and letting the field grow inline once the desktop toolbar
 * fits search, filters, and create on one row
 */
export function getSearchFieldWrapperClassName(mobileSearchStuck: boolean, desktopInlineLayout: boolean): string {
  return joinClassNames(
    'transition-[margin-right] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
    mobileSearchStuck ? 'max-[1049px]:mr-14' : 'max-[1049px]:mr-0',
    desktopInlineLayout && 'min-[750px]:min-w-80 min-[750px]:flex-1',
  )
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
