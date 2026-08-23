import type { ReactNode } from 'react'
import LoadFailure from '@/components/errors/LoadFailure'
import { LoadingContent, LoadingOverlay } from '@/components/loading/Transition'

/**
 * Wraps dashboard widget content with the shared loading conceal and overlay behaviour, and says
 * why the widget is missing where its request did not come back
 *
 * A widget holding nothing does not render blank: net worth renders $0.00, and runway, credit and
 * spending comparison each render a zero of their own. So the box takes the place of the content
 * rather than sitting over a confident figure no request produced. It takes the place of a figure
 * that did load earlier too. Every widget holds a height its row sets and clips to it, and on the
 * shortest row the box fills that height, so a figure kept underneath would render where nobody
 * could see it. The two taller rows have room for both and drop the figure anyway, since one rule
 * across the eight is what keeps a failed widget reading the same wherever it sits. The figure is
 * still in the cache and comes back with the next request that succeeds
 */
export function DashboardWidgetLoadingBody({
  children,
  contentConcealed,
  error,
  failed,
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

  loadingVisible: boolean
  shouldReduceMotion: boolean
  label: string

  /** What did not load, in the words the widget's own header uses for it */
  subject: string

  className?: string
  contentClassName?: string
}) {
  return (
    <div className={`relative min-h-0 overflow-hidden ${className}`}>
      <LoadingContent
        concealed={contentConcealed}
        shouldReduceMotion={shouldReduceMotion}
        className={failed ? 'flex h-full flex-col' : contentClassName}
      >
        {failed ? (
          <LoadFailure compact error={error} standalone subject={subject} />
        ) : children}
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
