import { MAINTENANCE_MESSAGE } from '@/api/auth'
import FailureBlock, { type FailureBlockSize } from '@/components/errors/FailureBlock'

export const MAINTENANCE_HEADING = "We'll be back soon"

/**
 * The heading, the maintenance sentence and a Reload button, drawn the same as the recovery screen
 *
 * It offers no error details to copy, since nothing went wrong in the app. The reload keeps this
 * browser's storage, because a maintenance never comes from anything saved in it
 */
export function MaintenanceMessage({ error = null, size }: { error?: unknown; size: FailureBlockSize }) {
  return (
    <FailureBlock
      detail={MAINTENANCE_MESSAGE}
      error={error}
      heading={MAINTENANCE_HEADING}
      preserveStoredData
      reportable={false}
      serverUnreachable={false}
      size={size}
    />
  )
}
