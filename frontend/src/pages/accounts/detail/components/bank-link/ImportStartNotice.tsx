import { Clock } from 'lucide-react'
import { importStartReminder } from '@/components/bank-link-flow/constants'
import { InfoCallout } from '@/components/InfoCallout'

/**
 * Tells the user the history import is waiting for the other accounts they link to join it. It holds
 * nothing to press, so it never takes focus. Sync now beside it starts the import at once
 */
export function ImportStartNotice() {
  return (
    <InfoCallout tone="info" icon={Clock}>
      {importStartReminder()}
    </InfoCallout>
  )
}
