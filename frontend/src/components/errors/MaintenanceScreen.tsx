import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { MAINTENANCE_HEADING, MaintenanceMessage } from '@/components/errors/MaintenanceMessage'

const SCREEN_FADE_SECONDS = 0.3

// The screen while it shows, read by the key listener below
let shownLayer: HTMLElement | null = null

// Inert stops focus and clicks, not the key listeners a dialogue or a shortcut puts on the window, so
// Escape would still close a dialogue under the screen and a save shortcut would still press Save.
// Listeners on the window run in the order they were added, so this one is added when the app's code
// loads, ahead of every other, and stops every key while the screen shows. Tab stays on Reload, the
// screen's only control, and Enter or Space on it still presses it, since that is the button's own
// default action
window.addEventListener(
  'keydown',
  (event) => {
    if (!shownLayer) return
    event.stopImmediatePropagation()
    if (event.key !== 'Tab') return
    event.preventDefault()
    shownLayer.querySelector('button')?.focus()
  },
  true,
)

/**
 * Covers the whole app while the server is in maintenance, for a signed-in user
 *
 * The app stays mounted underneath, so a half-filled form keeps its input, and the screen leaves by
 * itself once the server answers again. Everything else in the page is made inert while it shows, a
 * dialogue included, so the keyboard and a screen reader stay on the screen
 */
export function MaintenanceScreen({ shown }: { shown: boolean }) {
  const shouldReduceMotion = useReducedMotion() ?? false
  const layerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const layer = layerRef.current
    if (!shown || !layer) return

    // Only what this screen made inert is released afterwards, so a closed panel stays inert. A toast
    // or dialogue mounted while it shows is made inert as it arrives
    const madeInert: HTMLElement[] = []
    const makeInert = (element: Element) => {
      if (!(element instanceof HTMLElement) || element.contains(layer) || element.inert) return
      element.inert = true
      madeInert.push(element)
    }
    Array.from(document.body.children).forEach(makeInert)
    const arrivals = new MutationObserver((records) => {
      for (const record of records) record.addedNodes.forEach((node) => node instanceof Element && makeInert(node))
    })
    arrivals.observe(document.body, { childList: true })

    shownLayer = layer
    const previousFocus = document.activeElement
    layer.focus()

    return () => {
      shownLayer = null
      arrivals.disconnect()
      for (const element of madeInert) element.inert = false
      // Back where the user was, such as the field they were typing in
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [shown])

  return createPortal(
    <AnimatePresence initial={false}>
      {shown && (
        <motion.div
          key="maintenance-screen"
          ref={layerRef}
          role="alertdialog"
          aria-modal="true"
          aria-label={MAINTENANCE_HEADING}
          aria-describedby="maintenance-screen-message"
          tabIndex={-1}
          className="fixed inset-0 z-maintenance-screen flex items-center justify-center overflow-y-auto px-4 outline-none"
          style={{ backgroundColor: 'var(--app-bg)', color: 'var(--app-text)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: shouldReduceMotion ? 0 : SCREEN_FADE_SECONDS }}
        >
          <div id="maintenance-screen-message" className="w-full max-w-md">
            <MaintenanceMessage size="screen" />
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
