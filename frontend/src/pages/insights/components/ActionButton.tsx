import { useRef, type PointerEvent, type ReactNode } from 'react'
import { HintButton } from '@/components/tooltips/HintButton'

const TOUCH_CLICK_SUPPRESSION_MS = 1500

type InsightActionButtonProps = {
  // Names the button for a screen reader and says what it does in the hint
  ariaLabel: string
  onPress: () => void
  children: ReactNode
}

/**
 * Renders an icon action button that avoids double activation on delayed touch clicks
 */
export function InsightActionButton({ ariaLabel, onPress, children }: InsightActionButtonProps) {
  const suppressNextClick = useRef(false)
  const suppressionTimer = useRef<number | undefined>(undefined)

  /**
   * Triggers touch presses immediately while suppressing the delayed synthetic click
   */
  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.pointerType !== 'touch') return

    // iOS shows active feedback before dispatching the delayed click
    suppressNextClick.current = true
    if (suppressionTimer.current !== undefined) {
      window.clearTimeout(suppressionTimer.current)
    }
    suppressionTimer.current = window.setTimeout(() => {
      suppressNextClick.current = false
    }, TOUCH_CLICK_SUPPRESSION_MS)
    event.preventDefault()
    onPress()
  }

  /**
   * Runs mouse and keyboard activation unless a touch event already handled the press
   */
  function handleClick() {
    if (suppressNextClick.current) {
      suppressNextClick.current = false
      if (suppressionTimer.current !== undefined) {
        window.clearTimeout(suppressionTimer.current)
        suppressionTimer.current = undefined
      }
      return
    }

    onPress()
  }

  return (
    <HintButton
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      hint={ariaLabel}
      aria-label={ariaLabel}
      className="app-icon-button h-11 w-11 touch-manipulation min-[750px]:h-8 min-[750px]:w-8"
    >
      {children}
    </HintButton>
  )
}
