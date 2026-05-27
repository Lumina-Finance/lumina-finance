import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ForwardedRef,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefObject,
  type TransitionEvent as ReactTransitionEvent,
} from 'react'

type TooltipKey = string | number

export type ChartTooltipPointer = {
  clientX: number
  clientY: number
  chartX?: number
}

export type DeferredChartTooltipOverlayHandle<T> = {
  show: (item: T | null, pointer: ChartTooltipPointer) => void
  hide: () => void
}

type DeferredChartTooltipOverlayProps<T> = {
  chartRef: RefObject<HTMLDivElement | null>
  getKey: (item: T) => TooltipKey
  renderContent: (item: T) => ReactNode
  className?: string
  delayMs?: number
  showGuide?: boolean
}

const DEFAULT_DEFERRED_TOOLTIP_DELAY_MS = 45

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function DeferredChartTooltipOverlayInner<T>({
  chartRef,
  getKey,
  renderContent,
  className = '',
  delayMs = DEFAULT_DEFERRED_TOOLTIP_DELAY_MS,
  showGuide = true,
}: DeferredChartTooltipOverlayProps<T>, ref: ForwardedRef<DeferredChartTooltipOverlayHandle<T>>) {
  const tooltipRef = useRef<HTMLDivElement>(null)
  const guideRef = useRef<HTMLDivElement>(null)
  const [item, setItem] = useState<T | null>(null)
  const [visible, setVisible] = useState(false)
  const itemKeyRef = useRef<TooltipKey | null>(null)
  const pendingItemRef = useRef<T | null>(null)
  const lastPointerRef = useRef<ChartTooltipPointer | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const visibleRef = useRef(false)

  const positionTooltip = useCallback((pointer: ChartTooltipPointer) => {
    const rect = chartRef.current?.getBoundingClientRect()
    const tooltip = tooltipRef.current
    if (!rect || !tooltip) return

    const tooltipX = clamp(pointer.clientX - rect.left, 0, Math.max(rect.width - tooltip.offsetWidth, 0))
    const tooltipY = clamp(pointer.clientY - rect.top, 0, Math.max(rect.height - tooltip.offsetHeight, 0))
    const guideX = clamp(pointer.chartX ?? pointer.clientX - rect.left, 0, rect.width)

    tooltip.style.setProperty('--chart-tooltip-x', `${tooltipX}px`)
    tooltip.style.setProperty('--chart-tooltip-y', `${tooltipY}px`)
    guideRef.current?.style.setProperty('--chart-tooltip-guide-x', `${guideX}px`)
  }, [chartRef])

  const clearPending = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    pendingItemRef.current = null
  }, [])

  const setTooltipVisible = useCallback((nextVisible: boolean) => {
    if (visibleRef.current === nextVisible) return
    visibleRef.current = nextVisible
    setVisible(nextVisible)
  }, [])

  const commitPending = useCallback(() => {
    timerRef.current = null

    const nextItem = pendingItemRef.current
    pendingItemRef.current = null

    if (!nextItem) {
      setTooltipVisible(false)
      return
    }

    const nextKey = getKey(nextItem)
    if (itemKeyRef.current !== nextKey) {
      itemKeyRef.current = nextKey
      setItem(nextItem)
    }
    setTooltipVisible(true)
  }, [getKey, setTooltipVisible])

  const scheduleCommit = useCallback(() => {
    if (timerRef.current) return
    timerRef.current = setTimeout(commitPending, delayMs)
  }, [commitPending, delayMs])

  const show = useCallback((nextItem: T | null, pointer: ChartTooltipPointer) => {
    lastPointerRef.current = pointer
    positionTooltip(pointer)

    if (!nextItem) {
      pendingItemRef.current = null
      scheduleCommit()
      return
    }

    const nextKey = getKey(nextItem)
    if (itemKeyRef.current === nextKey) {
      clearPending()
      setTooltipVisible(true)
      return
    }

    pendingItemRef.current = nextItem
    scheduleCommit()
  }, [clearPending, getKey, positionTooltip, scheduleCommit, setTooltipVisible])

  const hide = useCallback(() => {
    clearPending()
    setTooltipVisible(false)
  }, [clearPending, setTooltipVisible])

  const handleTransitionEnd = useCallback((event: ReactTransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== 'opacity' || visibleRef.current) return
    setItem(null)
    itemKeyRef.current = null
  }, [])

  useImperativeHandle(ref, () => ({ show, hide }), [hide, show])

  useLayoutEffect(() => {
    if (!item || !lastPointerRef.current) return
    positionTooltip(lastPointerRef.current)
  }, [item, positionTooltip])

  useEffect(() => clearPending, [clearPending])

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {showGuide && (
        <div
          ref={guideRef}
          className="absolute top-0 h-full w-px"
          style={{
            background: 'var(--app-border-strong)',
            opacity: visible && item ? 1 : 0,
            transform: 'translate3d(var(--chart-tooltip-guide-x, 0px), 0, 0)',
            transition: 'opacity 150ms ease-out, transform 120ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        />
      )}
      <div
        ref={tooltipRef}
        className={`app-chart-tooltip-default-content pointer-events-none absolute left-0 top-0 ${className}`}
        onTransitionEnd={handleTransitionEnd}
        style={{
          opacity: visible ? 1 : 0,
          transition: 'opacity 150ms ease-out, transform 120ms cubic-bezier(0.22, 1, 0.36, 1)',
          transform: 'translate3d(var(--chart-tooltip-x, 0px), var(--chart-tooltip-y, 0px), 0)',
        }}
      >
        {item && renderContent(item)}
      </div>
    </div>
  )
}

export const DeferredChartTooltipOverlay = forwardRef(DeferredChartTooltipOverlayInner) as <T>(
  props: DeferredChartTooltipOverlayProps<T> & {
    ref?: Ref<DeferredChartTooltipOverlayHandle<T>>
  },
) => ReactElement
