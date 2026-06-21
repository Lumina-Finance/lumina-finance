import {
  forwardRef,
  type CSSProperties,
  type ReactNode,
  type TransitionEvent as ReactTransitionEvent,
} from 'react'
import { createPortal } from 'react-dom'

type CursorTooltipPortalProps = {
  children: ReactNode
  className?: string
  onTransitionEnd?: (event: ReactTransitionEvent<HTMLDivElement>) => void
  style?: CSSProperties
}

const defaultTooltipStyle: CSSProperties = {
  transition: 'opacity 150ms ease-out, transform 160ms cubic-bezier(0.22, 1, 0.36, 1)',
  willChange: 'opacity, transform',
}

const CursorTooltipPortal = forwardRef<HTMLDivElement, CursorTooltipPortalProps>(function CursorTooltipPortal({
  children,
  className = '',
  onTransitionEnd,
  style,
}, ref) {
  const tooltip = (
    <div
      ref={ref}
      className="pointer-events-none fixed left-0 top-0 z-[60]"
      onTransitionEnd={onTransitionEnd}
      style={{
        ...defaultTooltipStyle,
        ...style,
      }}
    >
      {/* The inner card carries the above/below flip so it can animate while the outer wrapper keeps
          following the cursor instantly */}
      <div className={`app-cursor-tooltip-flip app-chart-tooltip-default-content ${className}`}>
        {children}
      </div>
    </div>
  )

  return typeof document === 'undefined' ? tooltip : createPortal(tooltip, document.body)
})

export default CursorTooltipPortal
