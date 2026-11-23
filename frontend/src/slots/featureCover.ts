import type { ComponentType } from 'react'
import type { GrantableFeature } from '@/api/user'

export type FeatureCoverScreenProps = {
  /** The feature whose page the screen covers */
  feature: GrantableFeature
}

/**
 * The screen drawn in place of a page whose feature the signed-in user isn't granted
 *
 * This is the one slot code built on the app fills. A build fills it by replacing this file with one
 * that exports its own screen under the same name and props. Left null, as here, the app never asks
 * the server which features the user is granted, and every page shows as it is
 */
export const FeatureCoverScreen: ComponentType<FeatureCoverScreenProps> | null = null
