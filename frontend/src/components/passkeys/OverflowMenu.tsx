import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MoreVertical } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { getMenuItemTarget } from '@/components/passkeys/menuKeyboard'
import { FLOATING_LAYER_PROPS } from '@/utils/floatingLayer'

interface OverflowMenuItem {
  label: string
  onSelect: () => void
  /** Leading icon, inheriting the item colour through currentColor */
  icon?: ReactNode
  /** Renders the item in the destructive colour, for actions like remove */
  danger?: boolean
}

interface OverflowMenuProps {
  /** Accessible name for the trigger, since it shows only an icon */
  label: string
  items: OverflowMenuItem[]
  disabled?: boolean
  /** The trigger, for a caller that has to hand focus back to it once something else has taken it */
  triggerRef: RefObject<HTMLButtonElement | null>
}

const MENU_WIDTH_PX = 160
const ITEM_HEIGHT_PX = 40
const VIEWPORT_MARGIN_PX = 8

// Grow the menu out of the trigger corner it is anchored to, rather than snapping it in
const MENU_TRANSITION = { duration: 0.14, ease: [0.25, 0.1, 0.25, 1] as const }

/**
 * An icon trigger that opens a small action menu in a portal, so it is never clipped by the height
 * animations or the scrollable body it sits inside. The menu is fixed to the trigger and closes on an
 * outside press, Escape, Tab or any scroll or resize, since a fixed menu would otherwise detach from its
 * trigger. Opened from the keyboard it takes focus on its first item, and Up, Down, Home and End move that
 * focus. Whenever it closes with focus inside it, focus goes back to the trigger rather than to the page
 */
export function OverflowMenu({ label, items, disabled = false, triggerRef }: OverflowMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number; opensUpward: boolean } | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [isOpenedByKeyboard, setIsOpenedByKeyboard] = useState(false)

  const openMenu = (byKeyboard: boolean) => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return

    // Flip above the trigger when the menu would spill past the bottom of the viewport
    const menuHeight = items.length * ITEM_HEIGHT_PX + VIEWPORT_MARGIN_PX
    const opensUpward = rect.bottom + menuHeight + VIEWPORT_MARGIN_PX > window.innerHeight
    setPosition({
      top: opensUpward ? rect.top - menuHeight - 4 : rect.bottom + 4,
      left: Math.max(VIEWPORT_MARGIN_PX, rect.right - MENU_WIDTH_PX),
      opensUpward,
    })
    setIsOpenedByKeyboard(byKeyboard)
    setIsOpen(true)
  }

  const isFocusInMenu = useCallback(() => menuRef.current?.contains(document.activeElement) ?? false, [])

  // The focused item leaves the page as the menu fades, and focus would fall to the page with it, so the
  // trigger takes focus first. A stacked dialogue the chosen item opens then takes the trigger as its opener
  const closeMenuKeepingFocus = useCallback(() => {
    const hadFocus = isFocusInMenu()

    // Keep the last position while closing so the exit animation stays anchored to the trigger
    setIsOpen(false)
    if (hadFocus) triggerRef.current?.focus({ preventScroll: true })
  }, [isFocusInMenu, triggerRef])

  useEffect(() => {
    if (!isOpen) return

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return

      const hadFocus = isFocusInMenu()
      setIsOpen(false)

      // The press moves focus to the control it lands on and that control keeps it. A press that lands on
      // no control leaves focus on the page or on the dialogue's own panel, neither of which Tab reaches,
      // and only then does the trigger take focus back
      if (hadFocus) {
        window.setTimeout(() => {
          if (!(document.activeElement instanceof HTMLElement) || document.activeElement.tabIndex < 0) {
            triggerRef.current?.focus({ preventScroll: true })
          }
        })
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      // The trigger has just taken focus back, so after Tab the browser carries on from the trigger
      if (event.key === 'Escape' || event.key === 'Tab') {
        closeMenuKeepingFocus()
        return
      }

      if (event.ctrlKey || event.metaKey || event.altKey) return

      // Focus on the trigger counts as a way in, since a mouse press opens the menu with focus left there
      const menuItems = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
      if (!isFocusInMenu() && active !== triggerRef.current) return

      const target = getMenuItemTarget(event.key, active ? menuItems.indexOf(active) : -1, menuItems.length)
      if (target === null) return

      // Held so the key does not also scroll the page, since any scroll closes the menu
      event.preventDefault()
      menuItems[target].focus({ preventScroll: true })
    }

    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', closeMenuKeepingFocus)

    // Capture so a scroll in the modal body, not just the window, also dismisses the menu
    window.addEventListener('scroll', closeMenuKeepingFocus, true)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', closeMenuKeepingFocus)
      window.removeEventListener('scroll', closeMenuKeepingFocus, true)
    }
  }, [isOpen, isFocusInMenu, closeMenuKeepingFocus, triggerRef])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        disabled={disabled}
        // A click with no pointer position is a key press on the button, and the menu answers it by taking focus
        onClick={(event) => (isOpen ? closeMenuKeepingFocus() : openMenu(event.detail === 0))}
        className="shrink-0 rounded-md p-1.5 text-[var(--app-text-muted)] transition-control hover:bg-[var(--app-hover-soft)] hover:text-[var(--app-text)] motion-reduce:transition-none"
      >
        <MoreVertical size={18} aria-hidden />
      </button>
      {createPortal(
        <AnimatePresence>
          {isOpen && position && (
            <motion.div
              ref={menuRef}
              role="menu"
              aria-label={label}
              {...FLOATING_LAYER_PROPS}
              className="app-modal-panel fixed z-menu overflow-hidden rounded-lg"
              style={{
                top: position.top,
                left: position.left,
                width: MENU_WIDTH_PX,
                transformOrigin: position.opensUpward ? 'bottom right' : 'top right',
              }}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={MENU_TRANSITION}
            >
              {items.map((item, index) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  // Arrow keys move between the items and Tab closes the menu, so no item is a stop of its own
                  tabIndex={-1}
                  autoFocus={isOpenedByKeyboard && index === 0}
                  onClick={() => {
                    closeMenuKeepingFocus()
                    item.onSelect()
                  }}
                  className="app-focus-inset first:rounded-t-lg last:rounded-b-lg flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-control hover:bg-[color:var(--app-hover-soft)]"
                  style={{ color: item.danger ? 'var(--app-negative)' : 'var(--app-text)' }}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  )
}
