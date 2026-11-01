import { useEffect, useRef, useState, type RefObject } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { createPortal } from 'react-dom'
import { CircleCheck, LoaderCircle, TriangleAlert, X } from 'lucide-react'
import { getToastLift, TOAST_KEEP_CLEAR_SELECTOR } from '@/components/feedback/toastLift'

/** `saving` is progress for an action whose own control shows none, and gives way to the result */
export type ToastStatus = 'error' | 'success' | 'saving'

export interface ToastMessage {
  status: ToastStatus
  text: string
}

interface ToastProps {
  toast: ToastMessage | null
  onDismiss: () => void
}

const statusColor: Record<ToastStatus, string> = {
  error: 'var(--app-negative)',
  success: 'var(--app-positive)',
  saving: 'var(--app-accent)',
}

/**
 * Shows a short message in the bottom-right corner until it is dismissed
 *
 * An error is announced assertively, since it reports that something the user just asked for did not
 * happen and waiting for a pause in the screen reader's queue would lose that. The dismiss control is a
 * button inside the region rather than the region itself, so the message is what gets read out rather
 * than the name of the control
 *
 * It moves up out of the way of an element marked `data-toast-keep-clear` that it would cover, and
 * stays in its corner when nothing marked is under it
 */
export default function Toast({ toast, onDismiss }: ToastProps) {
  return createPortal(
    <AnimatePresence>{toast && <ToastCard toast={toast} onDismiss={onDismiss} />}</AnimatePresence>,
    document.body,
  )
}

/**
 * Keeps the message clear of the elements the page marks with `data-toast-keep-clear`, moving it up
 * above them for as long as it would cover one, and returns how far
 *
 * Measured on every frame while the message shows, since the element can move under it by a scroll,
 * a resize or the page changing around it, none of which tells the message
 */
function useToastLift(cardRef: RefObject<HTMLElement | null>) {
  const [lift, setLift] = useState(0)

  useEffect(() => {
    let frame = 0
    const measure = () => {
      const card = cardRef.current
      if (card) {
        const { left, right } = card.getBoundingClientRect()
        // Worked out from the layout rather than the drawn box, which the entrance and this lift move
        const bottom = document.documentElement.clientHeight - parseFloat(getComputedStyle(card).bottom)
        const usualBox = { left, right, top: bottom - card.offsetHeight, bottom }
        const keepClear = [...document.querySelectorAll(TOAST_KEEP_CLEAR_SELECTOR)]
          .map((element) => element.getBoundingClientRect())
          .filter((box) => box.width > 0 && box.height > 0)
        const next = getToastLift(usualBox, keepClear)
        setLift((current) => (Math.abs(current - next) < 0.5 ? current : next))
      }
      frame = requestAnimationFrame(measure)
    }
    measure()
    return () => cancelAnimationFrame(frame)
  }, [cardRef])

  return lift
}

function ToastCard({ toast, onDismiss }: { toast: ToastMessage; onDismiss: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null)
  const lift = useToastLift(cardRef)

  return (
    <motion.div
      ref={cardRef}
      role={toast.status === 'error' ? 'alert' : 'status'}
      aria-live={toast.status === 'error' ? 'assertive' : 'polite'}
      className="fixed bottom-5 right-5 z-toast flex max-w-[min(24rem,calc(100vw-2.5rem))] items-start gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium shadow-lg"
      style={{
        background: 'var(--app-bg)',
        border: '1px solid var(--app-border-strong)',
        color: 'var(--app-text)',
        // Set on every frame rather than eased, so it stays the same gap above an element that is
        // itself moving, such as the footer while the page settles after an undo, and never lags behind
        // it and overshoots. The entrance and exit slide below is its own, separate transform
        translate: `0 ${-lift}px`,
      }}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.16 }}
    >
      <span
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
        style={{ background: statusColor[toast.status], color: 'var(--app-bg)' }}
      >
        {toast.status === 'error' ? (
          <TriangleAlert size={14} strokeWidth={3} aria-hidden />
        ) : toast.status === 'saving' ? (
          <LoaderCircle size={14} strokeWidth={3} className="animate-spin" aria-hidden />
        ) : (
          <CircleCheck size={14} strokeWidth={3} aria-hidden />
        )}
      </span>
      <span className="leading-6">{toast.text}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss message"
        className="app-icon-button -mr-1 h-6 w-6 shrink-0 self-center"
      >
        <X size={14} aria-hidden />
      </button>
    </motion.div>
  )
}
