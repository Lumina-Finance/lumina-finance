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
  maxWidth: 'var(--app-cursor-tooltip-max-width, calc(100vw - 16px))',
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
      className={`app-chart-tooltip-default-content pointer-events-none fixed left-0 top-0 z-[60] ${className}`}
      onTransitionEnd={onTransitionEnd}
      style={{
        ...defaultTooltipStyle,
        ...style,
      }}
    >
      {children}
    </div>
  )

  return typeof document === 'undefined' ? tooltip : createPortal(tooltip, document.body)
})

export default CursorTooltipPortal
