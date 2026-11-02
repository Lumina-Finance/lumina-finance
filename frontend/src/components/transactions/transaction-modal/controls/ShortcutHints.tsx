import { useContext, type ReactNode } from 'react'
import { ShortcutHintsVisibleContext } from '@/components/transactions/transaction-modal/controls/shortcutHintsVisible'

type ShortcutHintsProps = {
  children: ReactNode

  /**
   * Where the caps hang. "after" puts them after the label they belong to, in the nearest
   * `relative` ancestor, and "save" puts them just above the save button, near its right end
   */
  placement?: 'after' | 'save'
}

/**
 * Lays the key caps of one control over the page while the action key is held, taking no room of
 * its own so that showing them moves nothing. The nearest `relative` ancestor is what they hang
 * from. Hidden from assistive technology, since the controls carry their shortcut in `aria-keyshortcuts`
 */
export default function ShortcutHints({ children, placement = 'after' }: ShortcutHintsProps) {
  const visible = useContext(ShortcutHintsVisibleContext)

  return (
    <span className={`app-shortcut-hints app-shortcut-hints-${placement}`} data-visible={visible} aria-hidden>
      {children}
    </span>
  )
}
