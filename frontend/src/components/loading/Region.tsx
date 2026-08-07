import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  LOADING_VISIBILITY_MS,
  LoadingContent,
  LoadingOverlay,
  loadingVisibilityCss,
} from '@/components/loading/Transition'
import { getLoadingRegionHeight } from '@/components/loading/regionHeight'
import { useLoadingSnapshot } from '@/hooks/useLoadingSnapshot'

type LoadingRegionBaseProps = {
  loading: boolean
  label: string
  className?: string
  contentClassName?: string
  overlayClassName?: string
  transitionKey?: string

  /** Follows the content's height across the load, for content that animates no height of its own */
  animateLoadingHeight?: boolean
}

// The two forms are kept apart so children written as a function cannot be left without the
// snapshot they read, which would hand them undefined on the first render
type LoadingRegionProps<T> = LoadingRegionBaseProps & (
  | {
    /** Rows or values held through a transition, so they conceal rather than vanishing mid-blur */
    snapshot: T
    children: (displaySnapshot: T) => ReactNode
  }
  | {
    snapshot?: never
    children: ReactNode
  }
)

/**
 * Conceals a region behind a labelled overlay while its data loads
 *
 * Changing the transition key replays the concealment even when nothing is loading, so a region
 * that switches to a different subject covers the swap rather than letting the old content change
 * under the reader. The label stands in as that key when one is not passed
 */
export default function LoadingRegion<T>({
  children,
  loading,
  label,
  className = '',
  contentClassName,
  overlayClassName = 'absolute inset-0 z-10 flex items-center justify-center bg-[var(--app-bg)]',
  transitionKey,
  snapshot,
  animateLoadingHeight = false,
}: LoadingRegionProps<T>) {
  const {
    displaySnapshot,
    contentConcealed,
    loadingVisible,
    shouldReduceMotion,
  } = useLoadingSnapshot({
    snapshot: snapshot as T,
    loading,
    transitionKey: transitionKey ?? label,
  })
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [contentHeight, setContentHeight] = useState<number | null>(null)
  const [revealSettled, setRevealSettled] = useState(true)
  // Held only across a load, so an expanding row or an arriving page afterwards is the content's
  // own business and neither measures nor re-renders this region
  const heightHeld = animateLoadingHeight && (loadingVisible || !revealSettled)

  useEffect(() => {
    if (loadingVisible) {
      // Nothing reads this while the spinner is up, since the height then follows the content on
      // its own, so it is cleared a frame later rather than during the effect itself
      const clearFrameId = window.requestAnimationFrame(() => setRevealSettled(false))

      return () => window.cancelAnimationFrame(clearFrameId)
    }

    // Settled on a timer rather than on the transition ending, since a reveal that leaves the
    // height where it already was fires no transition at all and would strand a fixed height
    const settleTimeoutId = window.setTimeout(() => setRevealSettled(true), LOADING_VISIBILITY_MS)

    return () => window.clearTimeout(settleTimeoutId)
  }, [loadingVisible])

  useEffect(() => {
    const element = contentRef.current
    if (!heightHeld || !element) return undefined

    let frameId: number | null = null
    const updateHeight = () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(() => {
        frameId = null
        setContentHeight(element.getBoundingClientRect().height)
      })
    }

    updateHeight()
    const observer = new ResizeObserver(updateHeight)
    observer.observe(element)

    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      observer.disconnect()
      // Dropped rather than kept, since the content is free to change size while nothing is
      // measuring it and the next load would open at a height it no longer has
      setContentHeight(null)
    }
  }, [heightHeld])

  const height = getLoadingRegionHeight({
    loadingVisible,
    contentHeight,
    revealSettled,
    shouldReduceMotion,
  })
  const content = typeof children === 'function'
    ? (children as (displaySnapshot: T) => ReactNode)(displaySnapshot)
    : children

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{
        height: height ?? undefined,
        transition: shouldReduceMotion || !animateLoadingHeight
          ? undefined
          : `height ${loadingVisibilityCss}`,
      }}
    >
      <LoadingContent
        concealed={contentConcealed}
        shouldReduceMotion={shouldReduceMotion}
        className={contentClassName}
      >
        {animateLoadingHeight ? <div ref={contentRef}>{content}</div> : content}
      </LoadingContent>
      <LoadingOverlay
        visible={loadingVisible}
        shouldReduceMotion={shouldReduceMotion}
        label={label}
        className={overlayClassName}
      />
    </div>
  )
}
