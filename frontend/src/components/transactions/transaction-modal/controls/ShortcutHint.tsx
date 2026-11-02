import {
  formatFieldShortcut,
  formatSubmitShortcut,
  readIsMac,
  type ShortcutField,
} from '@/components/transactions/transaction-modal/utils/shortcuts'

// Read once, since the keyboard does not change while the page is open
const IS_MAC = readIsMac()

type ShortcutHintProps =
  | {
      /** The field whose jump shortcut to show */
      field: ShortcutField

      /** A word naming what the shortcut reaches, for a hint that stands where no label does */
      name?: string
      submit?: never
    }
  | { submit: true; field?: never; name?: never }

/**
 * A small key cap showing a shortcut in the form the platform writes it, with the action key the
 * shortcut is held with. `ShortcutHints` around it decides when it shows and where
 */
export default function ShortcutHint({ field, name, submit }: ShortcutHintProps) {
  const text = field ? formatFieldShortcut(field, IS_MAC) : submit ? formatSubmitShortcut(IS_MAC) : ''

  return (
    <kbd className="app-shortcut-hint">
      {name && <span className="mr-1.5 font-medium">{name}</span>}
      {text}
    </kbd>
  )
}
