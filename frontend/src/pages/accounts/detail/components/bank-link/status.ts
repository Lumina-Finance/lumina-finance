import type { AccountBankStatus, BankImportProgress } from '@/api/bank-sync'
import type { SyncStatusTone } from '@/components/display/SyncStatusDot'
import { formatDateLabel } from '@/utils/date'

export type BankSyncLabel = {
  label: string
  tone: SyncStatusTone

  /** Blinks while the app is fetching */
  pulse: boolean
}

/**
 * The account's bank sync as a dot and a label, which the identity card's Bank sync fact and the Bank
 * link section's Status both show, worked out from the account's link alone
 *
 * @param ownPersonal - Whether the account is the user's own personal account, the only kind linked
 * @param status - The account's link, undefined until read
 * @param failed - Whether reading the link failed
 */
export function describeBankSync(ownPersonal: boolean, status: AccountBankStatus | undefined, failed: boolean): BankSyncLabel {
  if (!ownPersonal) return { label: 'Manual only', tone: 'off', pulse: false }
  if (!status) return { label: failed ? "Couldn't check" : 'Checking…', tone: 'off', pulse: false }

  const { link } = status
  if (!link) return { label: 'Not linked', tone: 'off', pulse: false }
  if (link.state === 'choose_account') return { label: 'Choose bank account', tone: 'stopped', pulse: false }
  if (link.import) {
    return {
      label: `Importing · ${link.import.windows_done} of ${link.import.windows_total}`,
      tone: 'working',
      pulse: link.import.state === 'running',
    }
  }
  return { label: 'Linked', tone: 'ok', pulse: false }
}

/**
 * What an import is doing, by why it runs: a first link imports from its start, a relink catches up
 * on what the bank reported since the unlink, and a bank account chosen again catches up from its
 * new start. A finished one says so in the past tense
 */
export function describeImportHeading(progress: BankImportProgress): string {
  const done = progress.state === 'complete'
  const from = formatDateLabel(progress.requested_start)
  if (progress.kind === 'initial') return `${done ? 'Imported' : 'Importing'} from ${from}`
  if (progress.kind === 'relink') return `${done ? 'Caught up' : 'Catching up'} since the account was unlinked`
  return `${done ? 'Caught up' : 'Catching up'} from ${from}`
}
