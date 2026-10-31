import type { ActionKeySetting } from '@/utils/actionKey'
import { addDays, formatYmd, parseYmd } from '@/utils/date'

/** The fields a shortcut jumps to */
export type ShortcutField =
  | 'kind'
  | 'direction'
  | 'account'
  | 'counterpartyAccount'
  | 'merchant'
  | 'category'
  | 'tags'
  | 'date'
  | 'amount'
  | 'notes'

/** The parts of a key press the shortcuts read, as a React event and a test's plain object both carry them */
export type ShortcutKeyEvent = {
  key: string
  code: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  isComposing: boolean

  /** True for the right Alt key of layouts that type extra characters with it */
  altGraph: boolean

  /** True while the user's chosen action key is down. That is Alt unless they chose the left one alone */
  actionKey: boolean
}

/** What decides whether a transaction dialogue takes a key press, read from the page */
export type ShortcutKeyOwnership = {
  /** True when this dialogue is the last one on the page, so none is stacked over it */
  dialogIsTopmost: boolean

  /** True when the press is aimed inside a popover floating over the page */
  inFloatingLayer: boolean

  /** True when any popover is open */
  floatingLayerOpen: boolean

  /** True when the press is aimed inside this dialogue */
  insideThisDialog: boolean

  /** True when the press is aimed inside any dialogue */
  insideAnyDialog: boolean
}

/**
 * Reports whether the open transaction dialogue should take a key press, wherever focus is
 *
 * Only the topmost dialogue takes keys, a press aimed inside a popover belongs to the popover, and a
 * press aimed outside every dialogue, such as the page body after a click on blank space, is taken
 * unless a popover is open over the page
 */
export function ownsShortcutKey(ownership: ShortcutKeyOwnership): boolean {
  if (!ownership.dialogIsTopmost || ownership.inFloatingLayer) return false
  if (ownership.insideThisDialog) return true

  return !ownership.insideAnyDialog && !ownership.floatingLayerOpen
}

/**
 * Reports whether a key name is an Alt key. On a Mac there is no separate AltGr, so a browser that names
 * Option `AltGraph` still means Option. On Windows and Linux `AltGraph` is the right Alt key of a layout
 * that types characters with it, which is never the action key
 */
export function isAltKeyName(key: string, isMac: boolean): boolean {
  return key === 'Alt' || (isMac && key === 'AltGraph')
}

/**
 * Reports whether an Alt key is down in a press. A Mac browser may report Option as AltGraph alone
 */
export function isAltDown(event: Pick<ShortcutKeyEvent, 'altKey' | 'altGraph'>, isMac: boolean): boolean {
  return event.altKey || (isMac && event.altGraph)
}

/**
 * Reports whether a press is the action key itself, as opposed to a letter pressed with it
 *
 * The right Alt key of a layout that types characters with it reports as `AltGraph`, so off a Mac it never matches
 */
export function isActionKeyPress(
  event: Pick<ShortcutKeyEvent, 'key' | 'code'>,
  actionKey: ActionKeySetting,
  isMac: boolean,
): boolean {
  return isAltKeyName(event.key, isMac) && (actionKey === 'alt' || event.code === 'AltLeft')
}

/**
 * Reports whether the action key is down during another key's press
 *
 * A press says only that some Alt is down, so the left one alone needs to know whether the left key is
 * the one held
 *
 * @param altDown - Whether an Alt key is down in the press, from `isAltDown`
 * @param leftAltDown - Whether the left Alt key went down and has not come up
 */
export function isActionKeyHeld(altDown: boolean, actionKey: ActionKeySetting, leftAltDown: boolean): boolean {
  return altDown && (actionKey === 'alt' || leftAltDown)
}

// Matched on the physical key, because Option on a Mac turns a letter into another character and
// leaves `key` naming that character. The letters skip the ones a browser or the Mac keyboard claims
// with Alt: D, E, F, S, T, V, B and H open browser menus or the address bar, and E, I, N and U are
// dead keys that start an accent on a Mac
export const FIELD_SHORTCUTS: Record<ShortcutField, { code: string; letter: string }> = {
  kind: { code: 'KeyY', letter: 'Y' },
  direction: { code: 'KeyR', letter: 'R' },
  account: { code: 'KeyA', letter: 'A' },
  counterpartyAccount: { code: 'KeyO', letter: 'O' },
  merchant: { code: 'KeyM', letter: 'M' },
  category: { code: 'KeyC', letter: 'C' },
  tags: { code: 'KeyG', letter: 'G' },
  date: { code: 'KeyW', letter: 'W' },
  amount: { code: 'KeyP', letter: 'P' },
  notes: { code: 'KeyL', letter: 'L' },
}

/**
 * Reports whether a press carries the action key and nothing else
 *
 * The action key alone is the whole modifier. Control as well is how Windows types a character with the
 * right Alt key, and Command or Shift as well belongs to the browser and the system, so none of those
 * count
 */
function isActionKeyChord(event: ShortcutKeyEvent): boolean {
  return event.actionKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altGraph && !event.isComposing
}

/** Returns the field the action key plus a letter jumps to, or null for any other press */
export function getFieldShortcut(event: ShortcutKeyEvent): ShortcutField | null {
  if (!isActionKeyChord(event)) return null

  const match = Object.entries(FIELD_SHORTCUTS).find(([, shortcut]) => shortcut.code === event.code)
  return match ? (match[0] as ShortcutField) : null
}

/**
 * Reports whether a press is the action key plus Enter, the chord that submits from anywhere in the dialogue
 *
 * Control and Command plus Enter are left to the page, since the action key is the one modifier the
 * dialogue's shortcuts share
 */
export function isSubmitShortcut(event: ShortcutKeyEvent): boolean {
  return event.key === 'Enter' && isActionKeyChord(event)
}

/** What a key press asks the date field to do */
export type DateKeyAction = { kind: 'step'; days: number } | { kind: 'today' }

/**
 * Reads a press in the date field as a step of one day, or a jump to today
 *
 * `[` steps a day back and `]` a day forward, with no modifier. Neither is a character of a date, so
 * they step whatever has been typed. A `-` is not a step, since it is the separator of a date typed as
 * 2026-10-31. `t` jumps to today until a digit has been typed since focus arrived
 *
 * @param typedDigits - Whether a digit has been typed since focus came into the field
 */
export function getDateKeyAction(event: ShortcutKeyEvent, typedDigits: boolean): DateKeyAction | null {
  if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return null

  switch (event.key) {
    case '[':
      return { kind: 'step', days: -1 }
    case ']':
      return { kind: 'step', days: 1 }
    case 't':
    case 'T':
      return typedDigits ? null : { kind: 'today' }
    default:
      return null
  }
}

/**
 * Returns the date a step lands on, starting from today when the field holds no complete date
 *
 * @param value - The field's ISO date, empty while it is blank or only partly typed
 * @param today - Today's ISO date in the user's time zone
 */
export function stepDateValue(value: string, days: number, today: string): string {
  const current = parseYmd(value)

  return current ? formatYmd(addDays(current, days)) : today
}

/**
 * Reports whether the keyboard is a Mac's, whose keys are written Option as ⌥ and Command as ⌘
 *
 * `navigator.platform` is deprecated but is still the one answer every browser gives, and iPadOS
 * reports itself as a Mac
 */
export function isMacPlatform(platform: string): boolean {
  return /Mac|iPhone|iPad|iPod/.test(platform)
}

/** Reports whether this device's keyboard is a Mac's */
export function readIsMac(): boolean {
  return typeof navigator !== 'undefined' && isMacPlatform(navigator.platform || navigator.userAgent)
}

/** Writes the jump shortcut for a field the way the platform writes it, such as ⌥W or Alt+W */
export function formatFieldShortcut(field: ShortcutField, isMac: boolean): string {
  const { letter } = FIELD_SHORTCUTS[field]

  return isMac ? `⌥${letter}` : `Alt+${letter}`
}

/** Writes the submit shortcut the way the platform writes it, such as ⌥↵ or Alt+Enter */
export function formatSubmitShortcut(isMac: boolean): string {
  return isMac ? '⌥↵' : 'Alt+Enter'
}

/** The value of `aria-keyshortcuts` for a field, written with Alt for Option on every platform as ARIA does */
export function getAriaFieldShortcut(field: ShortcutField): string {
  return `Alt+${FIELD_SHORTCUTS[field].letter}`
}

/** The value of `aria-keyshortcuts` for the submit button */
export const ARIA_SUBMIT_SHORTCUT = 'Alt+Enter'
