import type { ComponentType } from 'react'
import { useFeatureGrants, type GrantableFeature } from '@/api/user'
import { FeatureCoverScreen, type FeatureCoverScreenProps } from '@/slots/featureCover'

export type FeatureCoverState =
  { status: 'shown' } | { status: 'pending' } | { status: 'covered'; Screen: ComponentType<FeatureCoverScreenProps> }

/**
 * Says whether a feature's page shows as it is or is covered by the build's screen
 *
 * A build with no screen always shows the page and never asks the server. A build with one waits for
 * the server's answer, and covers the page only when the user isn't granted the feature. A failed
 * answer shows the page as it is, since the page's own requests still meet the server's check and
 * each part says its own failure under its own heading
 *
 * @param feature - The feature the page belongs to
 */
export function useFeatureCover(feature: GrantableFeature): FeatureCoverState {
  const { data, isPending } = useFeatureGrants(FeatureCoverScreen !== null)
  if (FeatureCoverScreen === null) return { status: 'shown' }
  if (data === undefined) return isPending ? { status: 'pending' } : { status: 'shown' }
  return data.features.includes(feature) ? { status: 'shown' } : { status: 'covered', Screen: FeatureCoverScreen }
}
