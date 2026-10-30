import {
  forwardRef,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
  type TransitionEvent as ReactTransitionEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { STACKING_LEVELS } from '@/constants/stackingLevels'

type CursorTooltipPortalProps = {
  children: ReactNode
  className?: string
  onTransitionEnd?: (event: ReactTransitionEvent<HTMLDivElement>) => void
  style?: CSSProperties

  /** A test id for the tooltip's outer wrapper, which carries the fade */
  testId?: string
}

const FADE_TRANSITION = 'opacity var(--app-ease-duration) var(--app-ease-curve)'
const GLIDE_TRANSITION = `${FADE_TRANSITION}, transform var(--app-ease-duration) var(--app-ease-curve)`

// Frames to wait after the tooltip becomes visible before it may glide. Its callers place it again over
// the next frame, once the content has rendered and can be measured
const FRAMES_BEFORE_GLIDE = 2

const CursorTooltipPortal = forwardRef<HTMLDivElement, CursorTooltipPortalProps>(function CursorTooltipPortal(
  { children, className = '', onTransitionEnd, style, testId },
  ref,
) {
  // Only opacity animates while the tooltip appears. Its position starts from the default of 0px, or from
  // where it last showed, so animating it then would fly the tooltip in from the top left or from the
  // old spot. Once it has been placed, moving it between chart items glides, and keeps gliding through a
  // brief hide between two items until the fade has ended
  const isShown = Number(style?.opacity) > 0
  const [isGliding, setIsGliding] = useState(false)

  function handleTransitionEnd(event: ReactTransitionEvent<HTMLDivElement>) {
    if (!isShown && event.target === event.currentTarget && event.propertyName === 'opacity') setIsGliding(false)
    onTransitionEnd?.(event)
  }

  useEffect(() => {
    if (!isShown) return undefined

    let framesLeft = FRAMES_BEFORE_GLIDE
    let frame = 0
    const waitForFrame = () => {
      framesLeft -= 1
      if (framesLeft <= 0) setIsGliding(true)
      else frame = requestAnimationFrame(waitForFrame)
    }
    frame = requestAnimationFrame(waitForFrame)
    return () => cancelAnimationFrame(frame)
  }, [isShown])

  const tooltip = (
    <div
      ref={ref}
      data-testid={testId}
      data-gliding={isGliding || undefined}
      className="pointer-events-none fixed left-0 top-0"
      onTransitionEnd={handleTransitionEnd}
      style={{
        zIndex: STACKING_LEVELS.tooltip,
        transition: isGliding ? GLIDE_TRANSITION : FADE_TRANSITION,
        willChange: 'opacity, transform',
        ...style,
      }}
    >
      {/* The inner card carries the above/below flip so it can animate while the outer wrapper keeps
          following the cursor instantly */}
      <div className={`app-cursor-tooltip-flip app-chart-tooltip-default-content ${className}`}>{children}</div>
    </div>
  )

  return typeof document === 'undefined' ? tooltip : createPortal(tooltip, document.body)
})

export default CursorTooltipPortal
