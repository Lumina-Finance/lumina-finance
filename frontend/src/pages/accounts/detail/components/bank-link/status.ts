import {
  REVIEW_PAUSE_COUNT,
  REVIEW_RESUME_COUNT,
  type AccountBankStatus,
  type BankImportProgress,
  type BankLink,
  type BankProvidersResponse,
} from '@/api/bank-sync'
import type { SyncStatusTone } from '@/components/display/SyncStatusDot'
import { DATE_FORMATS, formatDate, formatDateLabel, getTodayYmd } from '@/utils/date'
import { formatRelativeFutureTime, formatRelativeTime } from '@/utils/relativeTime'

/**
 * Whether an account's page shows bank sync: while the deployment lets the user link through one of
 * its providers, and while the account is linked whatever that says, so its link can still be seen
 * and ended
 *
 * @param providers - The deployment's providers and whether the user may link, undefined until read
 * @param status - The account's link, undefined until read and for any account but the user's own personal ones
 */
export function showsBankSync(
  providers: BankProvidersResponse | undefined,
  status: AccountBankStatus | undefined,
): boolean {
  const offered = providers !== undefined && providers.may_link && providers.providers.length > 0
  return offered || Boolean(status?.link)
}

export type BankSyncLabel = {
  label: string
  tone: SyncStatusTone

  /** Blinks while the app is fetching */
  pulse: boolean

  /**
   * The Sync details tooltip's lines: what the label means, then only what it leaves unsaid. Empty
   * for an account with no live link. Its section says the rest in its own words
   */
  details: string[]
}

/**
 * Formats when an attempt runs, as a time on the user's today and with its date further out
 */
function formatAttemptTime(iso: string, timeZone: string | undefined): string {
  const date = new Date(iso)
  const isToday = getTodayYmd(timeZone, date) === getTodayYmd(timeZone)
  return formatDate(date, isToday ? DATE_FORMATS.time : DATE_FORMATS.monthDayTime, timeZone)
}

/**
 * Whose request limit the next sync waits on: the provider's once it has said its quota is spent,
 * otherwise the connection's own over the last 24 hours
 */
function describeBudgetWait(link: BankLink): string {
  return link.sync.held_by_provider
    ? `Next sync is waiting on ${link.provider_name}'s request limit`
    : `Next sync is waiting on this connection's 24-hour ${link.provider_name} request limit`
}

/**
 * A live link's state as the server chose it, worded with its facts. The server sends each state with
 * the facts its wording needs: an import its progress, an import waiting on the request budget and a
 * retry their times, and a retry its failure. A failure is added
 * wherever the state's first line doesn't already give it, apart from a fetch under way, and what
 * happens next only where the state doesn't say, so no line repeats another
 */
function describeLinkSync(link: BankLink, timeZone: string | undefined): BankSyncLabel {
  const { sync } = link
  const label = (tone: SyncStatusTone, text: string, details: (string | null)[], pulse = false): BankSyncLabel => ({
    label: text,
    tone,
    pulse,
    details: details.filter((line): line is string => line !== null),
  })
  // A link that never synced can still be retrying its import, or reconnected and waiting on its
  // catch-up. That reads as synced until the catch-up runs
  const synced = sync.last_success_at ? `Synced ${formatRelativeTime(sync.last_success_at)}` : 'Not synced yet'
  const failure = sync.last_failure
    ? `Last attempt failed ${formatRelativeTime(sync.last_failure.at)}: ${sync.last_failure.reason}`
    : null
  const next = sync.waiting_on_budget
    ? describeBudgetWait(link)
    : sync.next_attempt_at
      ? `Next sync ${formatRelativeFutureTime(sync.next_attempt_at)}`
      : null
  const importing = (progress: BankImportProgress) =>
    `Importing · ${progress.windows_done} of ${progress.windows_total}`
  const waiting = sync.waiting_new_count.toLocaleString()

  // A provider removed from the server outranks every state, since nothing the user does here resumes it
  if (!link.provider_available) return label('review', 'Provider unavailable', [synced, failure])

  switch (sync.state) {
    case 'reconnect_needed':
      return label('stopped', 'Reconnect needed', [`Reconnect ${link.provider_name} in Settings`, failure])
    case 'bank_signin_needed':
      return label('stopped', 'Bank sign-in needed', ['The app checks daily', failure])
    case 'choose_account':
      return label('stopped', 'Choose bank account', [`${link.provider_name} now lists it differently`, failure])
    case 'importing':
      return label('working', importing(link.import!), [`Since ${formatDateLabel(link.import!.requested_start)}`], true)
    case 'import_waiting_on_budget':
      return label('working', importing(link.import!), [
        `Next part at ${formatAttemptTime(sync.next_attempt_at!, timeZone)}, when the ${link.provider_name} request limit allows another request`,
      ])
    case 'paused':
      return label('review', `Paused · ${waiting} new to review`, [
        `Resumes at ${REVIEW_RESUME_COUNT} or fewer`,
        failure,
      ])
    case 'syncing':
      return label(
        'working',
        'Syncing',
        [sync.last_success_at ? `Last synced ${formatRelativeTime(sync.last_success_at)}` : 'Not synced yet'],
        true,
      )
    case 'opening_balance':
      return label('review', 'Opening balance to confirm', [synced, failure, next])
    case 'review_warning':
      return label('review', `${waiting} new to review`, [`Sync pauses at ${REVIEW_PAUSE_COUNT}`, failure, next])
    case 'retrying':
      return label('working', `Retrying at ${formatAttemptTime(sync.next_attempt_at!, timeZone)}`, [
        `Last attempt failed: ${sync.last_failure!.reason}`,
        synced,
      ])
    case 'synced':
      return label('ok', synced, [failure, next])
  }
}

/**
 * The account's bank sync as a dot, a label and the Sync details' lines, the one state every surface
 * shows. The server chooses a live link's state, so the identity card, the bank link section and the
 * review block always agree
 *
 * @param ownPersonal - Whether the account is the user's own personal account, the only kind linked
 * @param status - The account's link, undefined until read
 * @param failed - Whether reading the link failed
 * @param timeZone - The user's profile zone, used to decide whether a retry falls today
 */
export function describeBankSync(
  ownPersonal: boolean,
  status: AccountBankStatus | undefined,
  failed: boolean,
  timeZone?: string,
): BankSyncLabel {
  if (!ownPersonal) return { label: 'Manual only', tone: 'off', pulse: false, details: [] }
  if (!status) return { label: failed ? "Couldn't check" : 'Checking…', tone: 'off', pulse: false, details: [] }
  if (!status.link) return { label: 'Not linked', tone: 'off', pulse: false, details: [] }
  return describeLinkSync(status.link, timeZone)
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
