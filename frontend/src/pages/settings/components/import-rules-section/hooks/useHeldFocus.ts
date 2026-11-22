import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { pickFocusRuleId, type HeldRule } from '@/pages/settings/components/import-rules-section/utils/focus'

const ROW_SELECTOR = '[data-rule-id]'

/** The rows on screen, in order. The list holds its rows a moment before it shows them, so the page is the one truth */
function readShownRules(section: HTMLElement): { id: string }[] {
  return Array.from(section.querySelectorAll<HTMLElement>(ROW_SELECTOR), (row) => ({ id: row.dataset.ruleId! }))
}

/** A scroll to the nearest edge can leave a fraction of a pixel of the button outside. That still counts as in view */
const VIEW_TOLERANCE_PX = 1

/** Whether a control sits wholly inside the window, and inside every box around it that scrolls */
function isWhollyInView(element: HTMLElement): boolean {
  const box = element.getBoundingClientRect()
  let top = 0
  let bottom = window.innerHeight
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent).overflowY
    // A box that only clips, such as the one animating the list's height, is no place to scroll to
    if (overflow !== 'auto' && overflow !== 'scroll') continue
    const room = parent.getBoundingClientRect()
    top = Math.max(top, room.top)
    bottom = Math.min(bottom, room.bottom)
  }
  return box.top >= top - VIEW_TOLERANCE_PX && box.bottom <= bottom + VIEW_TOLERANCE_PX
}

/**
 * Keeps keyboard focus on a rule's Actions button through what happens to its row
 *
 * A move, a cancelled delete and a confirmed delete each take away the control that held focus, or draw the
 * row again, and the browser then puts focus on the page body. The caller holds a rule when it acts on it.
 * Whenever the rows on screen change and focus is on the page body, focus goes to the held rule's Actions
 * button, to the button of the rule now in its place when it has left the shown rows or been deleted, or to
 * `emptyRef` when no rule is left. A deleted rule's own button never takes focus, though its row may still be
 * shown
 *
 * The rows can move after focus is set, since a list that loses its scrolling box or a row that leaves changes
 * the height of everything below. Each time the section changes size or content while the hold lasts, a button
 * that holds focus and has been pushed partly out of the window or of the list's box is scrolled back in
 *
 * The hold ends at the next press, wheel, touch, key or focus the person makes elsewhere, so it never takes
 * focus or the scroll back from where they went
 *
 * The rows are read from the page, since the list shows a change a moment after it holds it
 *
 * @param sectionRef - The section holding the rows, each marked with `data-rule-id`
 * @param emptyRef - The control that takes focus when no rule is left
 */
export function useHeldFocus(sectionRef: RefObject<HTMLElement | null>, emptyRef: RefObject<HTMLElement | null>) {
  const [held, setHeld] = useState<HeldRule | null>(null)
  const settingFocus = useRef(false)

  const restoreFocus = (hold: HeldRule) => {
    const section = sectionRef.current
    if (!section) return
    const active = document.activeElement
    if (active && active !== document.body && active.isConnected) {
      // Focus is where the hold put it, or where the person is. Only a button this hold drew into the window's
      // edge is brought back, and only the Actions button of a rule
      if (
        active instanceof HTMLElement &&
        active.matches(`${ROW_SELECTOR} [aria-haspopup="menu"]`) &&
        !isWhollyInView(active)
      ) {
        active.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
      }
      return
    }

    const id = pickFocusRuleId(readShownRules(section), hold)
    const target =
      id === null
        ? emptyRef.current
        : section.querySelector<HTMLElement>(`[data-rule-id="${CSS.escape(id)}"] [aria-haspopup="menu"]`)
    if (!target) return

    settingFocus.current = true
    target.focus()
    settingFocus.current = false
  }

  // The effects below read the latest restore through this, since each only sees the render it was made in
  const restoreRef = useRef(restoreFocus)
  useEffect(() => {
    restoreRef.current = restoreFocus
  })

  useLayoutEffect(() => {
    if (held) restoreRef.current(held)
  }, [held])

  useEffect(() => {
    const section = sectionRef.current
    if (!held || !section) return

    const restore = () => restoreRef.current(held)
    const watcher = new MutationObserver(restore)
    watcher.observe(section, { childList: true, subtree: true })
    const resizer = new ResizeObserver(restore)
    resizer.observe(section)

    const release = () => {
      if (!settingFocus.current) setHeld(null)
    }
    const events = ['pointerdown', 'focusin', 'wheel', 'touchstart', 'keydown'] as const
    for (const name of events) document.addEventListener(name, release, true)
    return () => {
      watcher.disconnect()
      resizer.disconnect()
      for (const name of events) document.removeEventListener(name, release, true)
    }
  }, [held, sectionRef])

  /**
   * Holds focus on a rule's Actions button, from the place the rule has among the rows on screen
   *
   * @param deleted - The rule is being deleted, so focus goes to the rule that takes its place and never to it
   */
  const holdRule = (id: string, deleted = false) => {
    const section = sectionRef.current
    const index = section ? readShownRules(section).findIndex((rule) => rule.id === id) : 0
    setHeld({ id, index: Math.max(0, index), deleted })
  }

  return { holdRule }
}
