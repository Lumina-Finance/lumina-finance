import { REVIEW_RESUME_COUNT, type BankConnection, type BankLink, type BankProvidersResponse } from '@/api/bank-sync'
import type { ActionFeedbackStatus } from '@/components/feedback/ActionButton'
import { formatRelativeFutureTime } from '@/utils/relativeTime'

/** Why Sync now can't run while the bank sync worker is down, which would leave the sync queued until it's back */
export const SYNC_PAUSED_REASON = "Bank sync isn't running right now. You can sync once it's back."

/** What a Sync now the server didn't answer says, while one it refused gives the server's reason */
export const SYNC_FAILED_MESSAGE = 'Sync could not start. Please try again.'

/**
 * Whether the bank sync worker is down, so nothing starts a sync until it's back
 *
 * @param providers - Whether the bank sync worker is running, undefined until read
 */
export function isSyncWorkerDown(providers: BankProvidersResponse | undefined): boolean {
  return providers !== undefined && !providers.sync_running
}

/**
 * Why Sync now can't run on a live link, or null while it can
 *
 * The server refuses the same states, a sync already running and a spent request budget, with the
 * same words, so the button says why before the user presses it. A reason of two sentences ends
 * with a full stop, as the one for a worker that's down does, while the server's messages end
 * without one. A bank sign-in doesn't hold it back, so the user can check straight after signing in
 * again at the provider, though a sync running under it does. A budget reads as free once its time
 * has passed, though the connection still says spent until it is read again
 *
 * @param link - The live link
 * @param connection - Its connection, whose request budget a sync spends, undefined until read
 * @param providers - Whether the bank sync worker is running, undefined until read
 */
export function describeSyncNowBlock(
  link: BankLink,
  connection: BankConnection | undefined,
  providers: BankProvidersResponse | undefined,
): string | null {
  if (link.sync.state === 'importing') return 'The import is still running'
  if (link.sync.state === 'syncing' || link.sync.sync_running) return 'A sync is already running'
  switch (link.sync.state) {
    case 'reconnect_needed':
      return `Reconnect ${link.provider_name} in Settings before syncing`
    case 'choose_account':
      return 'Choose the bank account again before syncing'
    case 'paused':
      return `Syncing is paused until ${REVIEW_RESUME_COUNT} or fewer new items are waiting for review`
    default:
      break
  }
  if (isSyncWorkerDown(providers)) return SYNC_PAUSED_REASON

  const budget = connection?.request_budget
  if (budget?.available_again_at && Date.parse(budget.available_again_at) > Date.now()) {
    const when = formatRelativeFutureTime(budget.available_again_at)
    return budget.held_by_provider
      ? `${link.provider_name} says this connection has reached its request limit. More are available ${when}.`
      : `This connection has used its ${budget.limit} ${link.provider_name} requests in the last 24 hours. More are available ${when}.`
  }
  return null
}

/**
 * What Sync now shows, and why it is held back while it shows nothing under way. It reads Starting
 * sync while this press or another window's waits for a worker to start the sync. While the worker is
 * down nothing starts it, so the button shows why instead
 *
 * @param feedback - What this window's own press shows
 * @param link - The live link
 * @param connection - Its connection, whose request budget a sync spends, undefined until read
 * @param providers - Whether the bank sync worker is running, undefined until read
 */
export function describeSyncNow(
  feedback: ActionFeedbackStatus,
  link: BankLink,
  connection: BankConnection | undefined,
  providers: BankProvidersResponse | undefined,
): { status: ActionFeedbackStatus; block: string | null } {
  const status = chooseSyncNowStatus(feedback, link, isSyncWorkerDown(providers))
  return { status, block: status === 'idle' ? describeSyncNowBlock(link, connection, providers) : null }
}

function chooseSyncNowStatus(
  feedback: ActionFeedbackStatus,
  link: BankLink,
  workerDown: boolean,
): ActionFeedbackStatus {
  if (workerDown) return feedback === 'loading' ? 'idle' : feedback
  return feedback === 'idle' && link.sync.sync_requested ? 'loading' : feedback
}
