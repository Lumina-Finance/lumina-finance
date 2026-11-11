import {
  REVIEW_RESUME_COUNT,
  isBankSyncNotSetUp,
  type BankConnection,
  type BankLink,
  type BankProvidersResponse,
} from '@/api/bank-sync'
import { BANK_SYNC_NOT_SET_UP_REASON } from '@/components/bank-link-flow/constants'
import type { ActionFeedbackStatus } from '@/components/feedback/ActionButton'
import { PROVIDER_UNAVAILABLE_DETAIL } from '@/utils/bankSync'
import { formatRelativeFutureTime } from '@/utils/relativeTime'

/** What a Sync now the server didn't answer says, while one it refused gives the server's reason */
export const SYNC_FAILED_MESSAGE = 'Sync could not start. Please try again.'

/**
 * Why Sync now can't run on a live link, or null while it can
 *
 * While the import waits for the user's other accounts to join it nothing holds Sync now back, since
 * a press starts the import at once, ahead of every state below as it is on the server. Once the
 * import runs it is held back. The server refuses the same states, a sync already running and a spent request budget, with the
 * same words, so the button says why before the user presses it. A reason of two sentences ends
 * with a full stop, as the one for bank sync not being set up does, while the server's messages end
 * without one. A bank sign-in doesn't hold it back, so the user can check straight after signing in
 * again at the provider, though a sync running under it does. A budget reads as free once its time
 * has passed, though the connection still says spent until it is read again
 *
 * @param link - The live link
 * @param connection - Its connection, the owner of the request budget a sync spends, undefined until read
 * @param providers - Whether the bank sync worker is running, undefined until read
 */
export function describeSyncNowBlock(
  link: BankLink,
  connection: BankConnection | undefined,
  providers: BankProvidersResponse | undefined,
): string | null {
  if (link.sync.import_starts_at !== null) return null
  if (!link.provider_available) return PROVIDER_UNAVAILABLE_DETAIL
  if (link.sync.state === 'importing') return 'The import is still running'
  if (link.sync.state === 'syncing' || link.sync.sync_running) return 'A sync is already running'
  switch (link.sync.state) {
    case 'reconnect_needed':
      return `Please reconnect ${link.provider_name} in Settings first`
    case 'choose_account':
      return 'Please choose the bank account again first'
    case 'paused':
      return `Paused until ${REVIEW_RESUME_COUNT} or fewer items wait for review`
    default:
      break
  }
  if (isBankSyncNotSetUp(providers)) return BANK_SYNC_NOT_SET_UP_REASON

  const budget = connection?.request_budget
  if (budget?.available_again_at && Date.parse(budget.available_again_at) > Date.now()) {
    const when = formatRelativeFutureTime(budget.available_again_at)
    return budget.held_by_provider
      ? `${link.provider_name} says this connection has reached its request limit. More are available ${when}.`
      : `This connection has used its ${budget.limit} ${link.provider_name} requests in the last 24 hours. More are available ${when}.`
  }
  return null
}

/** Why a date range can't be imported while another runs on the account, as the server says it */
export const RANGE_IMPORT_RUNNING_REASON = 'A date range import is already running'

/**
 * Why Import a date range can't start on a live link, or null while it can
 *
 * The server refuses it while a range already runs and for every reason it refuses Sync now, the
 * request budget included, since each of its windows is a request. Unlike Sync now it never starts an
 * import waiting for the user's other accounts, so that wait holds it back as the import running does
 *
 * @param link - The live link
 * @param connection - Its connection, the owner of the request budget a sync spends, undefined until read
 * @param providers - Whether the bank sync worker is running, undefined until read
 */
export function describeRangeImportBlock(
  link: BankLink,
  connection: BankConnection | undefined,
  providers: BankProvidersResponse | undefined,
): string | null {
  if (link.range_import) return RANGE_IMPORT_RUNNING_REASON
  if (link.provider_available && link.sync.import_starts_at !== null) return 'The import is still running'
  return describeSyncNowBlock(link, connection, providers)
}

/**
 * What Sync now shows, and why it is held back while it shows nothing under way. It reads Starting
 * sync while this press or another window's waits for a worker to start the sync. While bank sync
 * isn't set up nothing starts it, so the button shows why instead
 *
 * @param feedback - What this window's own press shows
 * @param link - The live link
 * @param connection - Its connection, the owner of the request budget a sync spends, undefined until read
 * @param providers - Whether the bank sync worker is running, undefined until read
 */
export function describeSyncNow(
  feedback: ActionFeedbackStatus,
  link: BankLink,
  connection: BankConnection | undefined,
  providers: BankProvidersResponse | undefined,
): { status: ActionFeedbackStatus; block: string | null } {
  const status = chooseSyncNowStatus(feedback, link, isBankSyncNotSetUp(providers))
  return { status, block: status === 'idle' ? describeSyncNowBlock(link, connection, providers) : null }
}

function chooseSyncNowStatus(feedback: ActionFeedbackStatus, link: BankLink, notSetUp: boolean): ActionFeedbackStatus {
  if (notSetUp) return feedback === 'loading' ? 'idle' : feedback
  return feedback === 'idle' && link.sync.sync_requested ? 'loading' : feedback
}
