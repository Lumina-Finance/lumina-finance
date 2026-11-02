import { useEffect, useRef, useState } from 'react'
import type { DateStepHighlight } from '@/components/transactions/transaction-modal/controls/dateStepHighlight'
import { getTransactionModalIds } from '@/components/transactions/transaction-modal/ids'
import {
  getDateKeyAction,
  getFieldShortcut,
  isAltDown,
  isAltKeyName,
  isSubmitShortcut,
  nextChoiceIndex,
  ownsShortcutKey,
  readIsMac,
  resolveDateStep,
  type ShortcutKeyEvent,
} from '@/components/transactions/transaction-modal/utils/shortcuts'
import { useAuth } from '@/hooks/useAuth'
import { getTodayYmd } from '@/utils/date'
import { isFloatingLayerOpen, isInsideFloatingLayer } from '@/utils/floatingLayer'

const OPEN_LIST_SELECTOR = '[role="combobox"][aria-expanded="true"]'
const DIALOG_SELECTOR = '[role="dialog"]'

/**
 * How long the action key is held before the key caps show. Long enough that a chord, where the user presses a
 * letter within about a fifth of a second, never flashes them, and short enough to not feel like a wait
 */
export const HINT_LONG_PRESS_MS = 300

/** How long the date field stays lit after the last bracket stepped it, just past the focus fade so the light peaks */
export const STEP_HIGHLIGHT_HOLD_MS = 180

/** How long the light takes to ease out, the same as the focus fade (`--app-focus-fade-duration`) */
export const STEP_HIGHLIGHT_FADE_MS = 150

/** The parts of a React or a browser key event the shortcuts read */
type KeyEventLike = Pick<
  globalThis.KeyboardEvent,
  'key' | 'code' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'getModifierState'
> & { isComposing?: boolean; nativeEvent?: { isComposing: boolean } }

/**
 * Reads the parts of a key event the shortcuts need
 *
 * @param isMac - Whether the keyboard is a Mac's, where AltGraph is only how a browser may report Option
 */
export function toShortcutKeyEvent(event: KeyEventLike, isMac: boolean): ShortcutKeyEvent {
  const altGraph = event.getModifierState('AltGraph')

  return {
    key: event.key,
    code: event.code,
    altKey: isAltDown({ altKey: event.altKey, altGraph }, isMac),
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    isComposing: event.nativeEvent?.isComposing ?? event.isComposing ?? false,
    altGraph: altGraph && !isMac,
  }
}

/** Reports whether any segment of the dialogue's date field holds digits, which a date left unfinished does */
function dateFieldHoldsDigits(ids: ReturnType<typeof getTransactionModalIds>): boolean {
  const group = document.getElementById(ids.date)?.closest('[role="group"]')

  return Array.from(group?.querySelectorAll('input') ?? []).some((segment) => segment.value !== '')
}

/**
 * Chooses the option after the chosen one in a group of tabs, wrapping from the last to the first, by
 * clicking it so the form answers as it does to a click. Focus stays where it was, so no focus ring shows on
 * the group. A group with every option held off, or that this form does not show, is left alone
 */
function cycleChoice(groupId: string) {
  const tabs = Array.from(
    document.getElementById(groupId)?.querySelectorAll<HTMLButtonElement>('button[role="tab"]:not(:disabled)') ?? [],
  )
  const next = nextChoiceIndex(
    tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true'),
    tabs.length,
  )
  if (next !== null) tabs[next].click()
}

/** Reports whether a key is aimed at a field that takes typed text, or a checkbox that sits among them */
function isTextEntry(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
}

/**
 * Finds the dialogue of the modal with this suffix, or null while it is not on the page
 */
function findDialog(ids: ReturnType<typeof getTransactionModalIds>): HTMLElement | null {
  return document.getElementById(ids.title)?.closest<HTMLElement>(DIALOG_SELECTOR) ?? null
}

/**
 * Reports whether this dialogue should take a key aimed at `target`. It must be on the page and the
 * topmost dialogue, so a dialogue stacked over it or a popover floating over it answers instead, and a
 * key aimed outside every dialogue, such as the page body after a click on blank space, is its own
 */
function takesKey(dialog: HTMLElement | null, target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : null
  const dialogs = document.querySelectorAll(DIALOG_SELECTOR)

  return ownsShortcutKey({
    dialogIsTopmost: !!dialog && dialogs[dialogs.length - 1] === dialog,
    inFloatingLayer: isInsideFloatingLayer(target),
    floatingLayerOpen: isFloatingLayerOpen(),
    insideThisDialog: !!dialog && !!element && dialog.contains(element),
    insideAnyDialog: !!element?.closest(DIALOG_SELECTOR),
  })
}

/**
 * The key handling for the transaction dialogue, and whether its key caps show. It listens on the window
 * while the dialogue is open, so it hears every key wherever focus is, including the page body after a
 * click on blank space. It stands down when no dialogue is open, when another dialogue is stacked over
 * this one, and when a popover over it holds the key
 *
 * The action key (either Alt key, Option on a Mac) plus a letter jumps to
 * a field, opening it when it is a dropdown so typing filters at once. Plus Enter it submits. Both work
 * the same from a text field, since neither is a character someone is typing
 *
 * Holding the action key for `HINT_LONG_PRESS_MS` shows the key caps until it is released, or until the
 * window loses focus, since the release would never arrive. A release that follows a long hold or a
 * chord is taken, so a browser that opens its menu when Alt comes up alone does not
 *
 * @param idSuffix - The modal's id suffix, telling it apart from the modal of an expense it refunds
 * @param open - Whether the modal is open
 * @param dateStep - The form's date, whether it can be changed, and how to change it, for `[` and `]`
 */
export function useTransactionShortcuts(
  idSuffix: string,
  open: boolean,
  dateStep: { date: string; steppable: boolean; onDateChange: (value: string) => void },
) {
  const { user } = useAuth()
  const dateStepRef = useRef(dateStep)
  const tz = user?.tz

  useEffect(() => {
    dateStepRef.current = dateStep
  })
  const isMac = readIsMac()
  const [holding, setHolding] = useState(false)
  const [hintsVisible, setHintsVisible] = useState(false)
  const [dateStepHighlight, setDateStepHighlight] = useState<DateStepHighlight>(null)
  const highlightTimersRef = useRef<number[]>([])
  const lightDateRef = useRef<() => void>(() => {})

  useEffect(() => {
    // Every press restarts the hold, so steps in a row keep the light on rather than blinking it
    lightDateRef.current = () => {
      highlightTimersRef.current.forEach((timer) => window.clearTimeout(timer))
      setDateStepHighlight('lit')
      const hold = window.setTimeout(() => {
        // Under reduced motion there is no fade to wait for, so the light goes at once
        // Read when the hold ends, so a change of the setting while the dialogue is open is followed
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        setDateStepHighlight(reduceMotion ? null : 'fading')
        if (reduceMotion) return
        highlightTimersRef.current = [window.setTimeout(() => setDateStepHighlight(null), STEP_HIGHLIGHT_FADE_MS)]
      }, STEP_HIGHLIGHT_HOLD_MS)
      highlightTimersRef.current = [hold]
    }
  })

  // A dialogue that closes, or goes, while the date is lit drops the light and its timers
  useEffect(
    () => () => {
      highlightTimersRef.current.forEach((timer) => window.clearTimeout(timer))
      highlightTimersRef.current = []
      setDateStepHighlight(null)
    },
    [open],
  )

  useEffect(() => {
    if (!open || !holding) return

    let usedWithAnotherKey = false
    let shown = false
    const timer = window.setTimeout(() => {
      shown = true
      setHintsVisible(true)
    }, HINT_LONG_PRESS_MS)

    const release = () => {
      setHolding(false)
      setHintsVisible(false)
    }

    // Seen on the window, since a shortcut can move focus out of the form before the key comes up
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.repeat || isAltKeyName(event.key, isMac)) return

      // A chord is not a long press, so a user who knows the key never sees the caps flash
      usedWithAnotherKey = true
      window.clearTimeout(timer)
    }
    const onKeyUp = (event: globalThis.KeyboardEvent) => {
      if (!isAltKeyName(event.key, isMac)) return

      // Windows and Linux browsers open their menu when Alt comes up on its own
      if (shown || usedWithAnotherKey) event.preventDefault()
      release()
    }
    const onWindowBlur = () => release()

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onWindowBlur)

    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onWindowBlur)
    }
  }, [open, holding, isMac])

  // A dialogue that closes while the key is held drops the hold, since nothing is left to show the caps on
  useEffect(
    () => () => {
      setHolding(false)
      setHintsVisible(false)
    },
    [open],
  )

  useEffect(() => {
    if (!open) return

    const ids = getTransactionModalIds(idSuffix)

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const dialog = findDialog(ids)
      if (!takesKey(dialog, event.target)) return

      // A first press of the key itself starts the hold, and one with another modifier is not the key alone
      if (isAltKeyName(event.key, isMac)) {
        if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.repeat) setHolding(true)
        return
      }

      const keyEvent = toShortcutKeyEvent(event, isMac)
      const form = dialog?.querySelector('form')
      if (!form) return

      if (isSubmitShortcut(keyEvent)) {
        // Taken whole, so the field under the key never sees an Enter and opens or chooses with it
        event.preventDefault()
        event.stopPropagation()

        // Holding the keys down repeats the press, and a save is one press
        if (event.repeat) return

        // Enter chooses from an open list, so a half-made choice is never saved. Close the list first
        if (form.querySelector(OPEN_LIST_SELECTOR)) return

        // Clicking the button runs exactly what a click on it does, including holding off while a save
        // is in flight and showing why a form with a problem cannot go ahead
        form.querySelector<HTMLButtonElement>('button[type="submit"]')?.click()
        return
      }

      // `[` and `]` step the date from any text field of the dialogue, so none of them types those two characters.
      // They repeat when held, which steps the date on, since that is how a far date is reached
      const step = getDateKeyAction(keyEvent, true)
      if (step?.kind === 'step' && isTextEntry(event.target)) {
        const { date, steppable, onDateChange } = dateStepRef.current
        const outcome = resolveDateStep(
          { date, steppable, hasTypedDigits: dateFieldHoldsDigits(ids) },
          step.days,
          getTodayYmd(tz),
        )
        if (outcome.kind === 'ignore') return

        event.preventDefault()
        event.stopPropagation()
        if (outcome.kind === 'hold') return

        onDateChange(outcome.value)

        // Focus stays in the field being typed in, so the date lights up to show the step landed there
        lightDateRef.current()
        return
      }

      const field = getFieldShortcut(keyEvent)
      if (!field) return

      // Held even when the field is not on show, so on a Mac the press never types the symbol Option makes
      event.preventDefault()
      event.stopPropagation()

      // Holding the keys down repeats the press, and a chord is one press: a held one would cycle a choice
      // round and round, or open and collapse its list over and over
      if (event.repeat) return

      // Type and Direction are choices, so each press chooses the next one as a click on it would
      if (field === 'kind' || field === 'direction') {
        cycleChoice(ids[field])
        return
      }

      const target = document.getElementById(ids[field])
      if (!target || target.matches(':disabled')) return

      // The chord pressed again over its own open list collapses it, as a click on the field does, so the
      // dropdown's own close runs, its search text clears and its collapse plays. Focus goes back to the
      // field, since the search box it was in is gone, so a third press opens the list again
      if (target.matches(OPEN_LIST_SELECTOR)) {
        target.click()
        target.focus()
        return
      }

      // Another list is closed before the jump so only the field being typed into has a list open
      for (const openList of form.querySelectorAll<HTMLElement>(OPEN_LIST_SELECTOR)) openList.click()

      target.focus()
      if (target instanceof HTMLInputElement) target.select()

      // A dropdown held off for a reason stays shut and shows that reason on focus
      if (target.getAttribute('role') === 'combobox' && target.getAttribute('aria-disabled') !== 'true') {
        target.click()
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open, idSuffix, isMac, tz])

  return { hintsVisible, dateStepHighlight }
}
