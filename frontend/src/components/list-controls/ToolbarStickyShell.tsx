import type { ReactNode, RefObject } from 'react'
import { getToolbarStickyRowClass, getToolbarStuckShadow } from '@/components/list-controls/toolbarStyles'

type ToolbarStickyShellProps = {
  toolbarRef: RefObject<HTMLDivElement | null>
  topRowSentinelRef: RefObject<HTMLDivElement | null>
  toolbarStuckSentinelRef: RefObject<HTMLDivElement | null>
  desktopInlineLayout: boolean
  isToolbarStuck: boolean
  isTopRowAtMenuButton: boolean
  children: ReactNode
}

/**
 * Renders the sticky toolbar row shared by the account and transaction list toolbars: the sentinels
 * that drive the mobile-stuck and desktop-dock detection, and the row itself docked to the
 * navigation pane line. The search field, mobile actions, and desktop controls are supplied as
 * children so this component owns only the docking chrome
 */
export function ToolbarStickyShell({
  toolbarRef,
  topRowSentinelRef,
  toolbarStuckSentinelRef,
  desktopInlineLayout,
  isToolbarStuck,
  isTopRowAtMenuButton,
  children,
}: ToolbarStickyShellProps) {
  return (
    <>
      <div ref={topRowSentinelRef} aria-hidden className="h-px min-[1050px]:hidden" />
      <div ref={toolbarStuckSentinelRef} aria-hidden className="h-px max-[1050px]:hidden" />
      {/* Marked as covering the list that scrolls under it, so a tooltip in a row just below opens
          downwards rather than going under the bar */}
      <div
        ref={toolbarRef}
        data-tooltip-cover

        // Stuck at any width, read by a browser test waiting for the row to settle once it sticks
        data-stuck={isToolbarStuck || isTopRowAtMenuButton ? 'true' : 'false'}
        className={getToolbarStickyRowClass(desktopInlineLayout)}
        style={{
          background: 'var(--app-bg)',
          boxShadow: getToolbarStuckShadow(isToolbarStuck),
        }}
      >
        {children}
      </div>
    </>
  )
}
