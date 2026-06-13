import type { ReactNode } from 'react'
import { LoadingContent, LoadingOverlay } from '@/components/LoadingTransition'

/**
 * Wraps dashboard widget content with the shared loading conceal and overlay behaviour
 */
export function DashboardWidgetLoadingBody({
  children,
  contentConcealed,
  loadingVisible,
  shouldReduceMotion,
  label,
  className = '',
  contentClassName = 'h-full',
}: {
  children: ReactNode
  contentConcealed: boolean
  loadingVisible: boolean
  shouldReduceMotion: boolean
  label: string
  className?: string
  contentClassName?: string
}) {
  return (
    <div className={`relative min-h-0 overflow-hidden ${className}`}>
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
        className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--app-surface-soft)]"
      />
    </div>
  )
}
