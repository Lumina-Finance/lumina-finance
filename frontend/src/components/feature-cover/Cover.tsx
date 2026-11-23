import type React from 'react'
import type { GrantableFeature } from '@/api/user'
import { useFeatureCover } from '@/components/feature-cover/useFeatureCover'

/**
 * Shows a feature's page as it is, or the build's screen in its place when the user isn't granted
 * the feature
 *
 * The page never mounts while it is covered or the answer is unknown, so it sends none of the
 * requests the server would refuse. The answer is small, and only a build with a screen waits for
 * it, so nothing is drawn meanwhile
 *
 * @param feature - The feature the page belongs to
 * @param id - The id the covering section takes, so links to the page's own section still land on it
 * @param className - Classes for the covering section
 */
export function FeatureCover({
  children,
  className,
  feature,
  id,
}: {
  children: React.ReactNode
  className?: string
  feature: GrantableFeature
  id?: string
}) {
  const cover = useFeatureCover(feature)
  if (cover.status === 'shown') return children
  if (cover.status === 'pending') return null
  return (
    <section id={id} className={className}>
      <cover.Screen feature={feature} />
    </section>
  )
}
