import type { ReactNode } from 'react'
import LoadFailure from '@/components/errors/LoadFailure'
import { LoadingContent, LoadingOverlay } from '@/components/loading/Transition'

/**
 * Wraps dashboard widget content with the shared loading conceal and overlay behaviour, and says
 * why the widget is missing where its request did not come back
 *
 * A widget holding nothing does not render blank: net worth renders $0.00, and runway, credit and
 * spending comparison each render a zero of their own. So the box takes the place of the content
 * where the widget has nothing to show, rather than sitting over a confident figure no request
 * produced. Where something did load earlier the box sits above it and that reading stays, since the
 * query cache is persisted and a failure that passes must not throw away a figure worth seeing
 */
export function DashboardWidgetLoadingBody({
  children,
  contentConcealed,
  error,
  failed,
  hasContent,
  loadingVisible,
  shouldReduceMotion,
  label,
  subject,
  className = '',
  contentClassName = 'h-full',
}: {
  children: ReactNode
  contentConcealed: boolean

  /** The rejection the widget's request reported, or the first of them where the widget reads several */
  error: unknown

  failed: boolean

  // Read from the snapshot the reveal is held against rather than from the live query, or the box
  // and the content would disagree for as long as that hold lasts
  /** Whether the widget has a figure or a list to show */
  hasContent: boolean

  loadingVisible: boolean
  shouldReduceMotion: boolean
  label: string

  /** What did not load, in the words the widget's own header uses for it */
  subject: string

  className?: string
  contentClassName?: string
}) {
  // Clipping and the zero minimum height are what stop the content stretching a widget whose height
  // is otherwise the one its row sets. Both come off while the box is up, so the widget grows to
  // hold it and the rest of its row grows with it
  const containment = failed ? '' : 'min-h-0 overflow-hidden'

  // With nothing else in the widget the box sits in the middle of the space. Where a figure survived
  // the failure it stays full width above that figure, since moving it to the middle would put it
  // over the figure it belongs above
  const boxAlone = failed && !hasContent

  return (
    <div className={`relative ${containment} ${className}`}>
      <LoadingContent
        concealed={contentConcealed}
        shouldReduceMotion={shouldReduceMotion}
        className={boxAlone ? 'flex h-full flex-col' : contentClassName}
      >
        {failed && <LoadFailure error={error} standalone={boxAlone} subject={subject} />}
        {(!failed || hasContent) && children}
      </LoadingContent>
      <LoadingOverlay
        visible={loadingVisible}
        shouldReduceMotion={shouldReduceMotion}
        label={label}
        className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--app-surface-soft)]"
      />
    </div>
  )
}
