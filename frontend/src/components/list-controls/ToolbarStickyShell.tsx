import type { ReactNode, RefObject } from 'react'
import { getToolbarStickyRowClass, getToolbarStuckShadow } from '@/components/list-controls/toolbarStyles'

type ToolbarStickyShellProps = {
  toolbarRef: RefObject<HTMLDivElement | null>
  mobileSearchStickySentinelRef: RefObject<HTMLDivElement | null>
  toolbarStuckSentinelRef: RefObject<HTMLDivElement | null>
  desktopInlineLayout: boolean
  isToolbarStuck: boolean
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
  mobileSearchStickySentinelRef,
  toolbarStuckSentinelRef,
  desktopInlineLayout,
  isToolbarStuck,
  children,
}: ToolbarStickyShellProps) {
  return (
    <>
      <div ref={mobileSearchStickySentinelRef} aria-hidden className="h-px min-[1050px]:hidden" />
      <div ref={toolbarStuckSentinelRef} aria-hidden className="h-px max-[1049px]:hidden" />
      <div
        ref={toolbarRef}
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
