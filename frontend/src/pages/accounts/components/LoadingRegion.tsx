import type { ReactNode } from 'react'
import { LoadingContent, LoadingOverlay } from '@/components/loading/Transition'
import { useLoadingSnapshot } from '@/hooks/useLoadingSnapshot'

/**
 * Conceals a region of the accounts page behind a labelled overlay while its data loads
 *
 * Changing the transition key replays the concealment even when nothing is loading, so a region
 * that switches to a different subject covers the swap rather than letting the old content change
 * under the reader. The label stands in as that key when one is not passed
 */
export default function AccountsLoadingRegion({
  children,
  loading,
  label,
  className = '',
  contentClassName,
  overlayClassName = 'absolute inset-0 z-10 flex items-center justify-center bg-[var(--app-bg)]',
  transitionKey,
}: {
  children: ReactNode
  loading: boolean
  label: string
  className?: string
  contentClassName?: string
  overlayClassName?: string
  transitionKey?: string
}) {
  const {
    contentConcealed,
    loadingVisible,
    shouldReduceMotion,
  } = useLoadingSnapshot({
    snapshot: null,
    loading,
    transitionKey: transitionKey ?? label,
  })

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <LoadingContent
        concealed={contentConcealed}
        shouldReduceMotion={shouldReduceMotion}
        className={contentClassName}
      >
        {children}
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
