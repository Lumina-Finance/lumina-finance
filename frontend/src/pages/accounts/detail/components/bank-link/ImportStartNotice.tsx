import { Clock } from 'lucide-react'
import { importStartReminder } from '@/components/bank-link-flow/constants'
import { InfoCallout } from '@/components/InfoCallout'

type ImportStartNoticeProps = {
  /** The link's provider, named in the reminder */
  providerName: string
}

/**
 * Tells the user the history import is waiting for the other accounts they link to join it. It holds
 * nothing to press, so it never takes focus. Sync now beside it starts the import at once
 */
export function ImportStartNotice({ providerName }: ImportStartNoticeProps) {
  return (
    <InfoCallout tone="info" icon={Clock}>
      {importStartReminder(providerName)}
    </InfoCallout>
  )
}
