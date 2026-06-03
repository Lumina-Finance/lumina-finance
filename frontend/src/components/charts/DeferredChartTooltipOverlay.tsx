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
import CursorTooltipPortal from '@/components/charts/CursorTooltipPortal'
import { getCursorTooltipPosition } from '@/utils/tooltipPosition'

type TooltipKey = string | number
type GuideVariant = 'line' | 'bar'

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
  boundsRef?: RefObject<HTMLDivElement | null>
  getKey: (item: T) => TooltipKey
  renderContent: (item: T) => ReactNode
  className?: string
  delayMs?: number
  showGuide?: boolean
  guideVariant?: GuideVariant
  guideWidth?: number
  guideMaxWidth?: number | ((chartWidth: number) => number)
}

const DEFAULT_DEFERRED_TOOLTIP_DELAY_MS = 45

function DeferredChartTooltipOverlayInner<T>({
  chartRef,
  boundsRef,
  getKey,
  renderContent,
  className = '',
  delayMs = DEFAULT_DEFERRED_TOOLTIP_DELAY_MS,
  showGuide = true,
  guideVariant = 'line',
  guideWidth = 28,
  guideMaxWidth,
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
    const chart = chartRef.current
    const rect = chart?.getBoundingClientRect()
    const bounds = boundsRef?.current ?? undefined
    const tooltip = tooltipRef.current
    if (!chart || !rect || !tooltip) return

    const { x: tooltipX, y: tooltipY, maxWidth } = getCursorTooltipPosition({
      origin: chart,
      tooltip,
      clientX: pointer.clientX,
      clientY: pointer.clientY,
      bounds,
    })
    const guideX = Math.min(Math.max(pointer.chartX ?? pointer.clientX - rect.left, 0), rect.width)
    const maxGuideWidth = typeof guideMaxWidth === 'function' ? guideMaxWidth(rect.width) : guideMaxWidth
    const resolvedGuideWidth = guideVariant === 'bar'
      ? Math.max(1, Math.min(guideWidth, maxGuideWidth ?? guideWidth))
      : 1

    tooltip.style.setProperty('--chart-tooltip-x', `${tooltipX}px`)
    tooltip.style.setProperty('--chart-tooltip-y', `${tooltipY}px`)
    tooltip.style.setProperty('--app-cursor-tooltip-max-width', `${maxWidth}px`)
    guideRef.current?.style.setProperty('--chart-tooltip-guide-x', `${guideX}px`)
    guideRef.current?.style.setProperty('--chart-tooltip-guide-width', `${resolvedGuideWidth}px`)
    guideRef.current?.style.setProperty('--chart-tooltip-guide-offset', `${resolvedGuideWidth / -2}px`)
  }, [boundsRef, chartRef, guideMaxWidth, guideVariant, guideWidth])

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

  const tooltip = (
    <CursorTooltipPortal
      ref={tooltipRef}
      className={className}
      onTransitionEnd={handleTransitionEnd}
      style={{
        opacity: visible ? 1 : 0,
        transform: 'translate3d(var(--chart-tooltip-x, 0px), var(--chart-tooltip-y, 0px), 0)',
      }}
    >
      {item && renderContent(item)}
    </CursorTooltipPortal>
  )

  return (
    <>
      <div className="pointer-events-none absolute inset-0 z-20">
        {showGuide && (
          <div
            ref={guideRef}
            className="absolute top-0 h-full"
            style={{
              background: guideVariant === 'bar' ? 'var(--app-border)' : 'var(--app-border-strong)',
              borderRadius: guideVariant === 'bar' ? 4 : undefined,
              opacity: visible && item ? (guideVariant === 'bar' ? 0.4 : 1) : 0,
              transform: guideVariant === 'bar'
                ? 'translate3d(calc(var(--chart-tooltip-guide-x, 0px) + var(--chart-tooltip-guide-offset, -14px)), 0, 0)'
                : 'translate3d(var(--chart-tooltip-guide-x, 0px), 0, 0)',
              transition: 'opacity 150ms ease-out, transform 120ms cubic-bezier(0.22, 1, 0.36, 1)',
              width: guideVariant === 'bar' ? 'var(--chart-tooltip-guide-width, 28px)' : 1,
            }}
          />
        )}
      </div>
      {tooltip}
    </>
  )
}

export const DeferredChartTooltipOverlay = forwardRef(DeferredChartTooltipOverlayInner) as <T>(
  props: DeferredChartTooltipOverlayProps<T> & {
    ref?: Ref<DeferredChartTooltipOverlayHandle<T>>
  },
) => ReactElement
