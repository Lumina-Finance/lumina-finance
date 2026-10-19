import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent } from 'react'
import { IMPORT_SIDE_BY_SIDE_QUERY } from '@/pages/imports/constants'
import {
  INITIAL_SETUP_PANEL_STATE,
  isSetupPanelOpen,
  reduceSetupPanel,
  type SetupPanelEvent,
  type SetupPanelState,
} from '@/pages/imports/utils/setupPanel'

const NON_TEXT_INPUT_TYPES = new Set(['button', 'checkbox', 'file', 'image', 'radio', 'range', 'reset', 'submit'])

// What in the panel's markup holds it open: a field marked invalid, an open dropdown, and the button of a date field
// whose calendar is open. A dropdown's list and a calendar both sit outside the panel, where the pointer and focus go
const CONTENT_HOLD_SELECTOR = '[aria-invalid="true"], [role="combobox"][aria-expanded="true"], [aria-haspopup="dialog"][aria-expanded="true"]'

/**
 * The outermost group a field sits in, which holds the field with its message, or the field itself
 * when it is in none. A date field is a group of its own parts inside the group of the dates
 *
 * @param field - The field marked invalid
 */
function groupHoldingMessage(field: Element): Element {
  let group = field.closest('[role="group"]')
  for (let outer = group?.parentElement?.closest('[role="group"]'); outer; outer = outer.parentElement?.closest('[role="group"]')) group = outer
  return group ?? field
}

/**
 * Scrolls an element into view in its scrolling parent, and again whenever it resizes, since the
 * error under a field appears and grows into place after the field is marked and would otherwise
 * end up below the fold
 *
 * @param element - What to bring into view
 * @returns A function that stops following the element
 */
function revealWhileResizing(element: Element): () => void {
  const reveal = () => element.scrollIntoView({ block: 'nearest' })
  const observer = new ResizeObserver(reveal)
  observer.observe(element)
  reveal()
  return () => observer.disconnect()
}

/**
 * Whether focus on an element should hold the setup panel open: the user is typing into a field or
 * has an open dropdown, or reached the control by keyboard. A control a mouse click left focus on,
 * such as the upload button or its file input, does not, so picking a file still collapses the panel
 *
 * @param element - The element that has focus
 */
function holdsPanelOpen(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false
  const isTextField = element instanceof HTMLTextAreaElement
    || (element instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.has(element.type))
    || element.isContentEditable
  const isOpenDropdown = element.getAttribute('role') === 'combobox' && element.getAttribute('aria-expanded') === 'true'
  return isTextField || isOpenDropdown || element.matches(':focus-visible')
}

/**
 * Holds whether the setup panel is collapsed, collapsing it for a file on desktop and bringing it
 * back when the files go, and gives the handlers that show it while it is hovered or focused
 *
 * A pointer that is only touching never hovers, since a tap on the collapsed strip is the caret's
 * click. Focus in a field being typed into, an open dropdown or a control reached by keyboard holds
 * the panel open, since collapsing it would drop what the user is doing. Focus a mouse click left on
 * a button or file input does not. A field in it marked invalid holds it open too, however
 * it got that way, so the reason is never hidden, and so does a date field's open calendar, which
 * lies outside the panel and would otherwise be left floating over the steps when the pointer moves on
 *
 * Below desktop none of that applies. The panel stacks above the steps and only its caret collapses
 * or expands it
 *
 * @param hasFile - Whether a file is staged and nothing about it needs the user's attention
 * @param onPointerInsideChange - Told when a mouse enters the panel and when it leaves, since a touch has no hover to end
 */
export function useImportSetupPanel(hasFile: boolean, onPointerInsideChange?: (isInside: boolean) => void) {
  const panelRef = useRef<HTMLElement>(null)
  const onPointerInsideChangeRef = useRef(onPointerInsideChange)
  useEffect(() => {
    onPointerInsideChangeRef.current = onPointerInsideChange
  })
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia?.(IMPORT_SIDE_BY_SIDE_QUERY).matches ?? false)
  const [state, setState] = useState<SetupPanelState>(INITIAL_SETUP_PANEL_STATE)
  const hadFileRef = useRef(hasFile)
  const send = (event: SetupPanelEvent) => setState((current) => reduceSetupPanel(current, event))

  useEffect(() => {
    const query = window.matchMedia(IMPORT_SIDE_BY_SIDE_QUERY)
    const update = () => setIsDesktop(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  // Watches the panel's own markup for an invalid field, an open dropdown or an open date calendar, which covers
  // every flow's fields without each one reporting in. Contents stay mounted while collapsed, so one that
  // goes invalid there is seen. An open dropdown or calendar holds the panel until it closes, since the
  // pointer and focus move to its list or grid, which sit outside the panel
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    let revealed: Element | null = null
    let stopFollowing = () => {}
    const read = () => {
      setState((current) => reduceSetupPanel(current, {
        type: 'content-hold-changed',
        isHeldByContent: panel.querySelector(CONTENT_HOLD_SELECTOR) !== null,
      }))

      // A field that has just gone invalid is scrolled into view, with its message, since the panel
      // scrolls and the message can sit below its fold
      const invalid = panel.querySelector('[aria-invalid="true"]')
      if (invalid === revealed) return
      revealed = invalid
      stopFollowing()
      if (invalid) stopFollowing = revealWhileResizing(groupHoldingMessage(invalid))
    }
    read()
    const observer = new MutationObserver(read)
    observer.observe(panel, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-invalid', 'aria-expanded'] })
    return () => {
      observer.disconnect()
      stopFollowing()
    }
  }, [])

  // The pointer is read from the DOM here rather than from React's handlers, which count what a portal renders as
  // inside the panel, so a date calendar the panel's fields open would count as hover on it
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const enter = (event: globalThis.PointerEvent) => {
      if (event.pointerType !== 'mouse') return
      setState((current) => reduceSetupPanel(current, { type: 'pointer-entered' }))
      onPointerInsideChangeRef.current?.(true)
    }
    const leave = (event: globalThis.PointerEvent) => {
      setState((current) => reduceSetupPanel(current, { type: 'pointer-left' }))
      if (event.pointerType === 'mouse') onPointerInsideChangeRef.current?.(false)
    }
    panel.addEventListener('pointerenter', enter)
    panel.addEventListener('pointerleave', leave)
    return () => {
      panel.removeEventListener('pointerenter', enter)
      panel.removeEventListener('pointerleave', leave)
    }
  }, [])

  // Before paint, so the panel is collapsed in the same frame the file arrives. Focus is read from
  // the page, since a removed button never reports that it lost it
  useLayoutEffect(() => {
    if (hasFile === hadFileRef.current) return
    hadFileRef.current = hasFile
    const isFocusInside = (panelRef.current?.contains(document.activeElement) ?? false) && holdsPanelOpen(document.activeElement)
    send(hasFile ? { type: 'file-staged', isDesktop, isFocusInside } : { type: 'files-cleared', isDesktop })
  }, [hasFile, isDesktop])

  return {
    panelRef,
    isDesktop,
    isCollapsed: state.isCollapsed,
    isOpen: isSetupPanelOpen(state, isDesktop),
    isPlacedAtOnce: state.isPlacedAtOnce,
    toggle: () => send({ type: 'toggled' }),
    peekHandlers: {
      // Focus events bubble through React from a portal too, so a calendar's are left out by the DOM
      onFocus: (event: FocusEvent) => {
        if (!event.currentTarget.contains(event.target)) return
        send({ type: holdsPanelOpen(event.target) ? 'focus-entered' : 'focus-left' })
      },
      onBlur: (event: FocusEvent) => {
        if (!event.currentTarget.contains(event.target)) return
        // A native file dialog blurs the window and leaves focus where it was, which is not leaving
        if (event.currentTarget.contains(event.relatedTarget) || event.currentTarget.contains(document.activeElement)) return
        send({ type: 'focus-left' })
      },
    },
  }
}
