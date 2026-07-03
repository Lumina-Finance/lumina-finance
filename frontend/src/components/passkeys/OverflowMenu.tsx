import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

interface OverflowMenuItem {
  label: string;
  onSelect: () => void;
  /** Leading icon, inheriting the item colour through currentColor */
  icon?: ReactNode;
  /** Renders the item in the destructive colour, for actions like remove */
  danger?: boolean;
}

interface OverflowMenuProps {
  /** Accessible name for the trigger, since it shows only an icon */
  label: string;
  items: OverflowMenuItem[];
  disabled?: boolean;
}

const MENU_WIDTH_PX = 160;
const ITEM_HEIGHT_PX = 40;
const VIEWPORT_MARGIN_PX = 8;

// Grow the menu out of the trigger corner it is anchored to, rather than snapping it in
const MENU_TRANSITION = { duration: 0.14, ease: [0.25, 0.1, 0.25, 1] as const };

/**
 * An icon trigger that opens a small action menu in a portal, so it is never clipped by the height
 * animations or the scrollable body it sits inside. The menu is fixed to the trigger and closes on an
 * outside press, Escape, or any scroll, since a fixed menu would otherwise detach from its trigger
 */
export function OverflowMenu({ label, items, disabled = false }: OverflowMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; opensUpward: boolean } | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const openMenu = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;

    // Flip above the trigger when the menu would spill past the bottom of the viewport
    const menuHeight = items.length * ITEM_HEIGHT_PX + VIEWPORT_MARGIN_PX;
    const opensUpward = rect.bottom + menuHeight + VIEWPORT_MARGIN_PX > window.innerHeight;
    setPosition({
      top: opensUpward ? rect.top - menuHeight - 4 : rect.bottom + 4,
      left: Math.max(VIEWPORT_MARGIN_PX, rect.right - MENU_WIDTH_PX),
      opensUpward,
    });
    setIsOpen(true);
  };

  // Keep the last position while closing so the exit animation stays anchored to the trigger
  const closeMenu = () => setIsOpen(false);

  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      closeMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };

    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', closeMenu);

    // Capture so a scroll in the modal body, not just the window, also dismisses the menu
    window.addEventListener('scroll', closeMenu, true);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
    };
  }, [isOpen]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        disabled={disabled}
        onClick={() => (isOpen ? closeMenu() : openMenu())}
        className="shrink-0 rounded-md p-1.5"
        style={{ color: 'var(--app-text-muted)' }}
      >
        <MoreVertical size={18} aria-hidden />
      </button>
      {createPortal(
        <AnimatePresence>
          {isOpen && position && (
            <motion.div
              ref={menuRef}
              role="menu"
              className="app-modal-panel fixed z-[80] overflow-hidden rounded-lg"
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
              {items.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    closeMenu();
                    item.onSelect();
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-[color:var(--app-surface-soft)]"
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
  );
}
