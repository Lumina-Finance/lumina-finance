/**
 * Guards the transaction dialogue's shortcut rules, so a key that types a character or belongs to the
 * browser or the system never jumps a field, Enter alone never submits as the chord does, the date steps
 * on the brackets, and a date typed as 2026-10-31 is never stepped by its hyphens
 */
import type { KeyboardEvent } from 'react'
import { describe, expect, it } from 'vitest'
import { HINT_LONG_PRESS_MS, toShortcutKeyEvent } from '@/components/transactions/transaction-modal/hooks/useShortcuts'
import {
  FIELD_SHORTCUTS,
  formatFieldShortcut,
  formatSubmitShortcut,
  getAriaFieldShortcut,
  getDateKeyAction,
  getFieldShortcut,
  isActionKeyHeld,
  isActionKeyPress,
  isAltDown,
  isAltKeyName,
  isMacPlatform,
  isSubmitShortcut,
  ownsShortcutKey,
  resolveDateStep,
  stepDateValue,
  type ShortcutKeyEvent,
} from '@/components/transactions/transaction-modal/utils/shortcuts'

const press = (overrides: Partial<ShortcutKeyEvent>): ShortcutKeyEvent => ({
  key: '',
  code: '',
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  isComposing: false,
  altGraph: false,
  actionKey: false,
  ...overrides,
})

/** A press with the action key down, as the dialogue reads it */
const withAction = (overrides: Partial<ShortcutKeyEvent>): ShortcutKeyEvent =>
  press({ altKey: true, actionKey: true, ...overrides })

describe('the action key', () => {
  it('is either Alt key by default, and the left one alone when chosen', () => {
    expect(isActionKeyPress({ key: 'Alt', code: 'AltRight' }, 'alt', false)).toBe(true)
    expect(isActionKeyPress({ key: 'Alt', code: 'AltLeft' }, 'alt', false)).toBe(true)
    expect(isActionKeyPress({ key: 'Alt', code: 'AltLeft' }, 'left-alt', false)).toBe(true)
    expect(isActionKeyPress({ key: 'Alt', code: 'AltRight' }, 'left-alt', false)).toBe(false)
  })

  it('is never the right Alt key of a layout that types with it, or any other key, off a Mac', () => {
    expect(isActionKeyPress({ key: 'AltGraph', code: 'AltRight' }, 'alt', false)).toBe(false)
    expect(isActionKeyPress({ key: 'Control', code: 'ControlLeft' }, 'alt', false)).toBe(false)
    expect(isActionKeyPress({ key: 'Meta', code: 'MetaLeft' }, 'alt', false)).toBe(false)
  })

  it('is Option on a Mac even when the browser names it AltGraph, which a Mac has no other use for', () => {
    expect(isActionKeyPress({ key: 'AltGraph', code: 'AltRight' }, 'alt', true)).toBe(true)
    expect(isActionKeyPress({ key: 'AltGraph', code: 'AltLeft' }, 'alt', true)).toBe(true)
    expect(isActionKeyPress({ key: 'AltGraph', code: 'AltLeft' }, 'left-alt', true)).toBe(true)
    expect(isActionKeyPress({ key: 'AltGraph', code: 'AltRight' }, 'left-alt', true)).toBe(false)
    expect(isActionKeyPress({ key: 'Control', code: 'ControlLeft' }, 'alt', true)).toBe(false)
  })

  it('counts AltGraph as Alt being down on a Mac only', () => {
    expect(isAltDown({ altKey: false, altGraph: true }, true)).toBe(true)
    expect(isAltDown({ altKey: false, altGraph: true }, false)).toBe(false)
    expect(isAltDown({ altKey: true, altGraph: false }, false)).toBe(true)
    expect(isAltKeyName('AltGraph', true)).toBe(true)
    expect(isAltKeyName('AltGraph', false)).toBe(false)
  })

  it('reads a Mac press reported as AltGraph with the action key held, and a Windows one without', () => {
    const base = {
      key: '∑',
      code: 'KeyW',
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      nativeEvent: { isComposing: false },
    }
    const macPress = { ...base, altKey: false, getModifierState: (name: string) => name === 'AltGraph' }
    const mac = toShortcutKeyEvent(macPress as unknown as KeyboardEvent, isActionKeyHeld(true, 'alt', false), true)
    expect(getFieldShortcut(mac)).toBe('date')

    const windows = toShortcutKeyEvent(
      macPress as unknown as KeyboardEvent,
      isActionKeyHeld(false, 'alt', false),
      false,
    )
    expect(getFieldShortcut(windows)).toBeNull()

    const altGr = { ...macPress, altKey: true }
    expect(getFieldShortcut(toShortcutKeyEvent(altGr as unknown as KeyboardEvent, true, false))).toBeNull()
    expect(getFieldShortcut(toShortcutKeyEvent(altGr as unknown as KeyboardEvent, true, true))).toBe('date')
  })

  it('is held for a letter only when the chosen Alt key is the one down', () => {
    expect(isActionKeyHeld(true, 'alt', false)).toBe(true)
    expect(isActionKeyHeld(true, 'left-alt', true)).toBe(true)

    // Some Alt is down, but it is the right one
    expect(isActionKeyHeld(true, 'left-alt', false)).toBe(false)
    expect(isActionKeyHeld(false, 'alt', false)).toBe(false)
  })
})

describe('field shortcuts', () => {
  it('jump on the action key plus the field letter, read from the physical key', () => {
    expect(getFieldShortcut(withAction({ key: 'w', code: 'KeyW' }))).toBe('date')

    // Option on a Mac turns the letter into another character, and the key is still the same one
    expect(getFieldShortcut(withAction({ key: '∑', code: 'KeyW' }))).toBe('date')
  })

  it('give every field its own physical key', () => {
    const codes = Object.values(FIELD_SHORTCUTS).map((shortcut) => shortcut.code)
    expect(new Set(codes).size).toBe(codes.length)
    for (const [field, shortcut] of Object.entries(FIELD_SHORTCUTS)) {
      expect(getFieldShortcut(withAction({ code: shortcut.code }))).toBe(field)
    }
  })

  it('leave a letter typed without the action key for the field being typed in', () => {
    expect(getFieldShortcut(press({ key: 'w', code: 'KeyW' }))).toBeNull()

    // The other Alt key is down, so with the left one chosen the letter is typing
    expect(getFieldShortcut(press({ altKey: true, key: 'w', code: 'KeyW' }))).toBeNull()
  })

  it('leave every other modifier to the browser, the system and the right Alt key of other layouts', () => {
    const alt = { key: 'w', code: 'KeyW' }
    expect(getFieldShortcut(withAction({ ...alt, ctrlKey: true }))).toBeNull()
    expect(getFieldShortcut(withAction({ ...alt, metaKey: true }))).toBeNull()
    expect(getFieldShortcut(withAction({ ...alt, shiftKey: true }))).toBeNull()
    expect(getFieldShortcut(withAction({ ...alt, altGraph: true }))).toBeNull()
    expect(getFieldShortcut(withAction({ ...alt, isComposing: true }))).toBeNull()
  })

  it('use no letter a browser menu or a Mac accent claims with Alt', () => {
    const claimed = ['KeyD', 'KeyE', 'KeyF', 'KeyS', 'KeyT', 'KeyV', 'KeyB', 'KeyH', 'KeyI', 'KeyN', 'KeyU']
    const used = Object.values(FIELD_SHORTCUTS).map((shortcut) => shortcut.code)
    expect(used.filter((code) => claimed.includes(code))).toEqual([])
  })
})

describe('submit shortcut', () => {
  it('is the action key plus Enter', () => {
    expect(isSubmitShortcut(withAction({ key: 'Enter' }))).toBe(true)
  })

  it('leaves Enter alone to submit or choose as it always has', () => {
    expect(isSubmitShortcut(press({ key: 'Enter' }))).toBe(false)
    expect(isSubmitShortcut(withAction({ key: 'Enter', shiftKey: true }))).toBe(false)
    expect(isSubmitShortcut(withAction({ key: 'Enter', isComposing: true }))).toBe(false)
  })

  it('no longer takes Control or Command plus Enter, which are not the action key', () => {
    expect(isSubmitShortcut(press({ key: 'Enter', ctrlKey: true }))).toBe(false)
    expect(isSubmitShortcut(press({ key: 'Enter', metaKey: true }))).toBe(false)
  })

  it('does not take Control with Alt, which is how Windows types with the right Alt key', () => {
    expect(isSubmitShortcut(withAction({ key: 'Enter', ctrlKey: true }))).toBe(false)
  })
})

describe('date keys', () => {
  it('step back on [ and forward on ], with no modifier', () => {
    expect(getDateKeyAction(press({ key: '[' }), false)).toEqual({ kind: 'step', days: -1 })
    expect(getDateKeyAction(press({ key: ']' }), false)).toEqual({ kind: 'step', days: 1 })
  })

  it('step even after a digit has been typed, since a bracket is never part of a date', () => {
    expect(getDateKeyAction(press({ key: '[' }), true)).toEqual({ kind: 'step', days: -1 })
    expect(getDateKeyAction(press({ key: ']' }), true)).toEqual({ kind: 'step', days: 1 })
  })

  it('no longer step on -, + or =, which a typed date needs or zoom uses', () => {
    for (const key of ['-', '+', '=']) expect(getDateKeyAction(press({ key }), false)).toBeNull()
  })

  it('jump to today on t in either case', () => {
    expect(getDateKeyAction(press({ key: 't' }), false)).toEqual({ kind: 'today' })
    expect(getDateKeyAction(press({ key: 'T', shiftKey: true }), false)).toEqual({ kind: 'today' })
  })

  it('leave every chord alone', () => {
    expect(getDateKeyAction(press({ key: '[', ctrlKey: true }), false)).toBeNull()
    expect(getDateKeyAction(press({ key: ']', metaKey: true }), false)).toBeNull()
    expect(getDateKeyAction(press({ key: ']', altKey: true }), false)).toBeNull()
    expect(getDateKeyAction(press({ key: 't', altKey: true }), false)).toBeNull()
  })

  it('leave t to typing once a digit has been typed', () => {
    expect(getDateKeyAction(press({ key: 't' }), true)).toBeNull()
  })
})

describe('stepping a date', () => {
  const today = '2026-10-31'

  it('moves one day across a month, a year and a leap day', () => {
    expect(stepDateValue('2026-10-31', 1, today)).toBe('2026-11-01')
    expect(stepDateValue('2026-01-01', -1, today)).toBe('2025-12-31')
    expect(stepDateValue('2028-02-28', 1, today)).toBe('2028-02-29')
    expect(stepDateValue('2026-03-01', -1, today)).toBe('2026-02-28')
  })

  it('starts from today when the field holds no complete date', () => {
    expect(stepDateValue('', 1, today)).toBe(today)
    expect(stepDateValue('2026-02-31', -1, today)).toBe(today)
  })
})

describe('what a bracket does to the date', () => {
  const today = '2026-10-31'
  const open = { steppable: true, hasTypedDigits: false }

  it('steps a whole date, and starts from today when the field is blank', () => {
    expect(resolveDateStep({ ...open, date: '2026-10-31' }, 1, today)).toEqual({ kind: 'step', value: '2026-11-01' })
    expect(resolveDateStep({ ...open, date: '' }, -1, today)).toEqual({ kind: 'step', value: today })
  })

  it('holds a date begun but not finished as it is, instead of replacing it with today', () => {
    expect(resolveDateStep({ date: '', steppable: true, hasTypedDigits: true }, 1, today)).toEqual({ kind: 'hold' })
  })

  it('lets the press through when the form cannot be changed', () => {
    expect(resolveDateStep({ date: '2026-10-31', steppable: false, hasTypedDigits: false }, 1, today)).toEqual({
      kind: 'ignore',
    })
    expect(resolveDateStep({ date: '', steppable: false, hasTypedDigits: true }, 1, today)).toEqual({ kind: 'ignore' })
  })
})

describe('how shortcuts are written', () => {
  it('uses Option on a Mac and Alt elsewhere, for every shortcut', () => {
    expect(formatFieldShortcut('date', true)).toBe('⌥W')
    expect(formatFieldShortcut('date', false)).toBe('Alt+W')
    expect(formatSubmitShortcut(true)).toBe('⌥↵')
    expect(formatSubmitShortcut(false)).toBe('Alt+Enter')
  })

  it('writes Option as Alt for assistive technology on every platform', () => {
    expect(getAriaFieldShortcut('merchant')).toBe('Alt+M')
    expect(getAriaFieldShortcut('date')).toBe('Alt+W')
  })

  it('takes Apple devices for a Mac keyboard', () => {
    expect(isMacPlatform('MacIntel')).toBe(true)
    expect(isMacPlatform('iPad')).toBe(true)
    expect(isMacPlatform('Win32')).toBe(false)
    expect(isMacPlatform('Linux x86_64')).toBe(false)
  })
})

describe('who takes a key press', () => {
  const page = {
    dialogIsTopmost: true,
    inFloatingLayer: false,
    floatingLayerOpen: false,
    insideThisDialog: false,
    insideAnyDialog: false,
  }

  it('is the open dialogue, for a press aimed at the page body as well as inside it', () => {
    expect(ownsShortcutKey({ ...page, insideThisDialog: true, insideAnyDialog: true })).toBe(true)
    expect(ownsShortcutKey(page)).toBe(true)
  })

  it('is never a dialogue with another dialogue stacked over it', () => {
    expect(ownsShortcutKey({ ...page, dialogIsTopmost: false, insideThisDialog: true })).toBe(false)
    expect(ownsShortcutKey({ ...page, dialogIsTopmost: false })).toBe(false)
  })

  it('leaves a press inside a popover to the popover, and a body press while a popover is open', () => {
    expect(ownsShortcutKey({ ...page, inFloatingLayer: true, floatingLayerOpen: true })).toBe(false)
    expect(ownsShortcutKey({ ...page, floatingLayerOpen: true })).toBe(false)

    // A popover opened from a field of the form does not stop that field's own shortcuts
    const fromField = { ...page, floatingLayerOpen: true, insideThisDialog: true, insideAnyDialog: true }
    expect(ownsShortcutKey(fromField)).toBe(true)
  })

  it('leaves a press aimed inside some other dialogue alone', () => {
    expect(ownsShortcutKey({ ...page, insideAnyDialog: true })).toBe(false)
  })

  it('shows the key caps after 300 ms', () => {
    expect(HINT_LONG_PRESS_MS).toBe(300)
  })
})
