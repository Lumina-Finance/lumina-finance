import { useEffect, useId, useRef, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { Link2, PauseCircle, SlidersHorizontal, TriangleAlert, Unlink } from 'lucide-react'
import { useNavigate } from 'react-router'
import type { Account } from '@/api/accounts'
import {
  REVIEW_PAUSE_COUNT,
  REVIEW_RESUME_COUNT,
  useBankConnections,
  type BankBalance,
  type BankConnection,
  type BankLink,
  type BankProvidersResponse,
  type BankSyncState,
  type OpeningAdjustment,
} from '@/api/bank-sync'
import { BankSyncNotSetUp } from '@/components/bank-link-flow/BankSyncNotSetUp'
import {
  BANK_CONNECTIONS_SETTINGS_PATH,
  BANK_SYNC_NOT_SET_UP_REASON,
  GROUP_ACCOUNT_LINK_REASON,
} from '@/components/bank-link-flow/constants'
import { BankLinkFlowModal } from '@/components/bank-link-flow/Modal'
import { Unfold } from '@/components/display/Unfold'
import LoadFailure from '@/components/errors/LoadFailure'
import { InfoCallout } from '@/components/InfoCallout'
import LoadingRegion from '@/components/loading/Region'
import { revealInScrollArea } from '@/components/modal/scrollArea'
import { StepTransition } from '@/components/two-factor/StepTransition'
import { useAuth } from '@/hooks/useAuth'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'
import { BalancePanel } from '@/pages/accounts/detail/components/bank-link/BalancePanel'
import { ImportProgress } from '@/pages/accounts/detail/components/bank-link/ImportProgress'
import { OpeningAdjustmentOffer } from '@/pages/accounts/detail/components/bank-link/OpeningAdjustmentOffer'
import {
  CutOffDayReminder,
  HistoryReminder,
  REMINDER_ATTRIBUTE,
} from '@/pages/accounts/detail/components/bank-link/Reminder'
import { ReviewSettingsModal } from '@/pages/accounts/detail/components/bank-link/ReviewSettingsModal'
import type { BankSyncLabel } from '@/pages/accounts/detail/components/bank-link/status'
import { SyncFact } from '@/pages/accounts/detail/components/bank-link/SyncFact'
import { SyncNowButton } from '@/pages/accounts/detail/components/bank-link/SyncNowButton'
import { UnlinkModal } from '@/pages/accounts/detail/components/bank-link/UnlinkModal'
import { useAccountBankLink } from '@/pages/accounts/detail/components/bank-link/useAccountBankLink'
import { useLingeringImport } from '@/pages/accounts/detail/components/bank-link/useLingeringImport'
import { EditModalSection } from '@/pages/accounts/detail/components/edit-identity/layout/Section'
import { IdentityFacts } from '@/pages/accounts/detail/components/identity/Facts'
import { describeSyncNowBlock, isBankSyncNotSetUp } from '@/pages/accounts/detail/components/bank-link/syncNow'
import { PROVIDER_UNAVAILABLE_DETAIL, providerSiteName } from '@/utils/bankSync'
import { DATE_FORMATS, formatDate, formatDateLabel } from '@/utils/date'

const ARCHIVED_REASON = 'Archived accounts are read-only'
const LOADING_OVERLAY_CLASS = 'absolute inset-0 z-10 flex items-center justify-center bg-[var(--app-bg)]'
const NOTICE_ACTION_CLASS = 'app-primary-button h-9 w-full justify-center whitespace-nowrap px-4 text-sm sm:w-auto'
const LINK_ACTION_CLASS = 'app-secondary-button h-9 w-full justify-center whitespace-nowrap px-3.5 text-sm sm:w-auto'

// Long enough for the modal to have opened and put focus in its first field
const OPENING_FOCUS_DELAY_MS = 260

/** Marks the control the modal focuses as it opens, in place of its first field */
type InitialFocusProps = { 'data-modal-field-tab-stop'?: 'true'; 'data-modal-initial-focus'?: 'true' }

// Marks each view's actions, the first not held back with its reason taking focus when the view swaps
// in, ahead of the Sync details icon among the facts above them
const ACTION_ATTRIBUTE = 'data-bank-link-action'
const ACTION_PROPS = { [ACTION_ATTRIBUTE]: 'true' }

// The states that are the import's own, the only ones its progress shows under, so a retry or a stop
// holding the import never reads as importing
const IMPORT_STATES: ReadonlySet<BankSyncState> = new Set(['importing', 'import_waiting_on_budget'])

type LinkedViewProps = {
  link: BankLink
  balance: BankBalance | null
  openingAdjustment: OpeningAdjustment | null

  /** The account's currency. A live link's bank account shares it */
  currency: string
  sync: BankSyncLabel
  connection: BankConnection | undefined
  providers: BankProvidersResponse | undefined
  initialFocus: InitialFocusProps
  onChooseBankAccount: () => void
  onReviewSettings: () => void
  onUnlink: () => void
}

/**
 * A live link: its facts and status, the import while it is the status, a notice for anything holding
 * its sync back, the reminders that history may be missing, the bank's balance beside the ledger's
 * once it has synced, with the opening adjustment offer at its foot while there is one, and the
 * actions on the link. A notice's own action comes first, since it is what resumes the sync. The
 * server leaves the review notices out while only the user can restart the sync, so a stop's notice
 * shows alone. A reminder holds nothing back, so the offer shows beside it. Neither the offer's
 * buttons nor a reminder's ✕ are among the view's actions, so the modal opening at the bank link never
 * starts on Skip or Dismiss, and an answer or a dismissal moves focus on to the link's actions, Sync
 * now first, as what held it folds away, or from one reminder to the next
 */
function LinkedView({
  link,
  balance,
  openingAdjustment,
  currency,
  sync,
  connection,
  providers,
  initialFocus,
  onChooseBankAccount,
  onReviewSettings,
  onUnlink,
}: LinkedViewProps) {
  const navigate = useNavigate()
  const viewRef = useRef<HTMLDivElement>(null)
  const actionsRef = useRef<HTMLDivElement>(null)
  const notSetUpReasonId = useId()
  const syncNotSetUp = describeSyncNowBlock(link, connection, providers) === BANK_SYNC_NOT_SET_UP_REASON
  const shownImport = useLingeringImport(link.import, link.state)
  const { state, paused, review_warning: warned } = link.sync
  const waiting = link.sync.waiting_new_count.toLocaleString()

  // An import that has just finished stays a moment as done, whatever the status has moved on to
  const showsImport = shownImport !== null && (shownImport.state === 'complete' || IMPORT_STATES.has(state))

  // A dismissed reminder folds away with the ✕ holding focus. Focus moves on to the next reminder's ✕,
  // or with none left, to the link's actions
  const moveOnFromReminder = (reminder: HTMLElement) => {
    const later = Array.from(viewRef.current?.querySelectorAll<HTMLElement>(`[${REMINDER_ATTRIBUTE}]`) ?? []).find(
      (other) => reminder.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING,
    )
    const dismiss = later?.querySelector<HTMLElement>('button')
    if (!dismiss) {
      focusFirstAction(actionsRef.current)
      return
    }
    dismiss.focus({ preventScroll: true })
    revealInScrollArea(dismiss)
  }

  return (
    <div ref={viewRef}>
      <IdentityFacts
        className=""
        facts={[
          { label: 'Bank account', value: link.external_account_name },
          { label: 'Institution', value: link.institution_name },
          { label: 'Through', value: link.provider_name },
          { label: 'History from', value: formatDateLabel(link.import_start) },
        ]}
      >
        <SyncFact name="Status" sync={sync} showsDetails />
      </IdentityFacts>

      <AnimatePresence initial={false}>
        {showsImport && (
          <Unfold key="import">
            <ImportProgress progress={shownImport} />
          </Unfold>
        )}
        {!link.provider_available && (
          <Unfold key="provider-unavailable">
            <InfoCallout tone="review" icon={TriangleAlert}>
              {PROVIDER_UNAVAILABLE_DETAIL}
            </InfoCallout>
          </Unfold>
        )}
        {link.provider_available && state === 'reconnect_needed' && (
          <Unfold key="reconnect">
            <InfoCallout
              tone="stopped"
              icon={TriangleAlert}
              action={
                <button
                  type="button"
                  className={NOTICE_ACTION_CLASS}
                  {...ACTION_PROPS}
                  {...initialFocus}
                  onClick={() => navigate(BANK_CONNECTIONS_SETTINGS_PATH)}
                >
                  Open settings
                </button>
              }
            >
              {providerSiteName(link)} rejected the connection this account uses. Automatic sync is stopped for every
              account on it until you reconnect it in Settings.
            </InfoCallout>
          </Unfold>
        )}
        {state === 'choose_account' && (
          <Unfold key="choose-account">
            <InfoCallout
              tone="stopped"
              icon={TriangleAlert}
              action={
                <button
                  type="button"
                  className={NOTICE_ACTION_CLASS}
                  {...ACTION_PROPS}
                  {...initialFocus}
                  onClick={onChooseBankAccount}
                >
                  Choose bank account
                </button>
              }
            >
              {link.provider_name} now lists {link.external_account_name} differently, so Lumina Finance can't tell
              whether it's the same account. Choose its bank account again to resume syncing.
            </InfoCallout>
          </Unfold>
        )}
        {state === 'bank_signin_needed' && (
          <Unfold key="bank-sign-in">
            <InfoCallout tone="stopped" icon={TriangleAlert}>
              Sign in to your bank again in {providerSiteName(link)}.
            </InfoCallout>
          </Unfold>
        )}
        {paused && (
          <Unfold key="paused">
            <InfoCallout tone="review" icon={PauseCircle}>
              Sync is paused with {waiting} new items waiting for review. It resumes on its own once{' '}
              {REVIEW_RESUME_COUNT} or fewer are left.
            </InfoCallout>
          </Unfold>
        )}
        {warned && (
          <Unfold key="warning">
            <InfoCallout tone="review" icon={TriangleAlert}>
              {waiting} new to review. Sync pauses at {REVIEW_PAUSE_COUNT}.
            </InfoCallout>
          </Unfold>
        )}
        {link.history_reminder && (
          <Unfold key="history-reminder">
            <HistoryReminder
              accountId={link.account_id}
              providerName={link.provider_name}
              reminder={link.history_reminder}
              onDismissed={moveOnFromReminder}
            />
          </Unfold>
        )}
        {link.cut_off_day && (
          <Unfold key="cut-off-day">
            <CutOffDayReminder
              accountId={link.account_id}
              providerName={link.provider_name}
              day={link.cut_off_day}
              onDismissed={moveOnFromReminder}
            />
          </Unfold>
        )}
        {balance && (
          <Unfold key="balance" clipsOnlyWhileChanging>
            <BalancePanel
              balance={balance}
              currency={currency}
              providerName={link.provider_name}
              footer={
                openingAdjustment && (
                  <OpeningAdjustmentOffer
                    accountId={link.account_id}
                    offer={openingAdjustment}
                    currency={currency}
                    providerName={link.provider_name}
                    onAnswered={() => focusFirstAction(actionsRef.current)}
                  />
                )
              }
            />
          </Unfold>
        )}
      </AnimatePresence>

      {/* The link's actions, in one row that wraps, each taking a full row on a phone */}
      <div ref={actionsRef} className="flex flex-wrap items-center gap-2 pt-4">
        <SyncNowButton
          link={link}
          connection={connection}
          providers={providers}
          focusProps={{ ...ACTION_PROPS, ...initialFocus }}
          notSetUpReasonId={notSetUpReasonId}
        />
        <button
          type="button"
          className={LINK_ACTION_CLASS}
          {...ACTION_PROPS}
          {...initialFocus}
          onClick={onReviewSettings}
        >
          <SlidersHorizontal size={14} aria-hidden />
          Review settings
        </button>
        <button type="button" className={LINK_ACTION_CLASS} {...ACTION_PROPS} {...initialFocus} onClick={onUnlink}>
          <Unlink size={14} aria-hidden />
          Unlink
        </button>
      </div>
      <AnimatePresence initial={false}>
        {syncNotSetUp && (
          <Unfold key="not-set-up">
            <BankSyncNotSetUp id={notSetUpReasonId} className="pt-3" />
          </Unfold>
        )}
      </AnimatePresence>
    </div>
  )
}

type BankLinkSectionProps = {
  account: Account
  sectionNumber: string

  /** Focuses the section's first control once it shows, for a modal opened at the bank link */
  autoFocus?: boolean
}

/**
 * Focuses the first action inside the element that isn't held back with its reason, as the modal
 * passes over a held field, since focus would open the reason over the section. With every action
 * held, the first takes focus anyway, so it stays inside the dialogue. A view that swaps in taller can
 * leave the action below what the modal shows, so the modal's scroll area brings it into view
 */
function focusFirstAction(container: HTMLElement | null) {
  const actions = Array.from(container?.querySelectorAll<HTMLElement>(`[${ACTION_ATTRIBUTE}]`) ?? [])
  const target = actions.find((action) => action.getAttribute('aria-disabled') !== 'true') ?? actions[0]
  if (!target) return
  target.focus({ preventScroll: true })
  revealInScrollArea(target)
}

/**
 * The account's bank link in its edit modal: linking it, relinking it after an unlink, its import and
 * status while linked, its review settings, and unlinking it. Every change here applies at once, not on
 * saving the modal
 */
export function BankLinkSection({ account, sectionNumber, autoFocus = false }: BankLinkSectionProps) {
  const { user } = useAuth()
  const { ownPersonal, status, statusError, providers, syncLabel } = useAccountBankLink(account)
  const { data: connections } = useBankConnections()
  const [linkFlowOpen, setLinkFlowOpen] = useState(false)
  const [linkFlowKey, setLinkFlowKey] = useState(0)

  // Held past the unlink itself, so the dialogue can finish closing once the link is gone
  const [unlinking, setUnlinking] = useState<BankLink | null>(null)
  const [unlinkOpen, setUnlinkOpen] = useState(false)

  // Mounted afresh for each opening, so the dialogue never starts on choices an earlier one left unsaved
  const [reviewSettingsOpen, setReviewSettingsOpen] = useState(false)
  const [reviewSettingsKey, setReviewSettingsKey] = useState(0)

  const link = status?.link ?? null
  const previous = status?.previous_link ?? null
  const linkingPaused = isBankSyncNotSetUp(providers)
  // Both reasons last, so the one that holds the button back is printed under it, with the tooltip
  // and the button's description pointing at that text
  const blockReasonId = useId()
  const linkBlockReason = account.is_archived
    ? ARCHIVED_REASON
    : linkingPaused
      ? BANK_SYNC_NOT_SET_UP_REASON
      : undefined

  const openLinkFlow = () => {
    setLinkFlowKey((key) => key + 1)
    setLinkFlowOpen(true)
  }

  const viewKey = !ownPersonal ? 'group' : !status ? 'loading' : link ? 'linked' : 'unlinked'
  const contentRef = useRef<HTMLDivElement>(null)
  const showsControls = viewKey === 'linked' || viewKey === 'unlinked'
  const initialFocus: InitialFocusProps = autoFocus
    ? { 'data-modal-field-tab-stop': 'true', 'data-modal-initial-focus': 'true' }
    : {}

  // The modal focuses the marked control as it opens. One that shows only once the link has loaded
  // misses that, so it waits for the modal to have opened and put focus in its first field instead.
  // A press or a key before then has put focus where the person wants it, so it stays there
  const [focusOnShow, setFocusOnShow] = useState(autoFocus && !showsControls)
  useEffect(() => {
    if (!focusOnShow) return undefined
    const keepTheirFocus = () => setFocusOnShow(false)
    document.addEventListener('pointerdown', keepTheirFocus, true)
    document.addEventListener('keydown', keepTheirFocus, true)
    return () => {
      document.removeEventListener('pointerdown', keepTheirFocus, true)
      document.removeEventListener('keydown', keepTheirFocus, true)
    }
  }, [focusOnShow])
  useEffect(() => {
    if (!focusOnShow || !showsControls) return undefined
    const timer = window.setTimeout(() => {
      setFocusOnShow(false)
      focusFirstAction(contentRef.current)
    }, OPENING_FOCUS_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [focusOnShow, showsControls])

  // Linking and unlinking swap the view, taking away the control the dialogue opened from, so focus would
  // fall to the page once the dialogue or the old view has gone. It moves to the new view's action
  // instead, after the dialogue has put focus back wherever it still could. Motion reports an exit before
  // React takes what left off the page, in a render a busy machine can draw a frame ahead of, so the
  // check waits for that render (the report's own update joins it) rather than for the next frame
  const [exitsReported, setExitsReported] = useState(0)
  const restoreLostFocus = () => setExitsReported((count) => count + 1)
  useEffect(() => {
    if (exitsReported === 0) return undefined
    const frame = window.requestAnimationFrame(() => {
      if (document.activeElement === null || document.activeElement === document.body)
        focusFirstAction(contentRef.current)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [exitsReported])

  return (
    <EditModalSection number={sectionNumber} title="Bank link">
      <div ref={contentRef}>
        {ownPersonal && statusError && !status ? (
          <LoadFailure error={statusError} subject="Bank link" />
        ) : (
          <LoadingRegion
            loading={viewKey === 'loading'}
            label="Loading bank link"
            animateLoadingHeight
            clipsOnlyWhileChanging
            overlayClassName={LOADING_OVERLAY_CLASS}
          >
            <StepTransition stepKey={viewKey} easeContentChanges={false} onExitComplete={restoreLostFocus}>
              {viewKey === 'loading' && <div className="min-h-16" />}
              {viewKey === 'group' && (
                <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                  {GROUP_ACCOUNT_LINK_REASON} Its transactions stay manual.
                </p>
              )}
              {/* The reason a pause gives for Link bank account keeps to the section's sides. The Sync
                    details in the linked view take the room the modal has. A short section lacks it */}
              {viewKey === 'unlinked' && (
                <div className="space-y-3" data-tooltip-bounds>
                  <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                    {previous
                      ? `Previously linked to ${previous.external_account_name} at ${previous.institution_name} through ${previous.provider_name}, until ${formatDate(new Date(previous.unlinked_at), DATE_FORMATS.monthDayYear, user?.tz)}. Reconnecting fetches what the bank reported since then.`
                      : 'Link this account to one of the bank accounts on your connections to bring in its transactions automatically. Everything the bank sends waits for your review before it touches a balance.'}
                  </p>
                  <DisabledReasonButton
                    className="app-primary-button"
                    {...ACTION_PROPS}
                    {...initialFocus}
                    disabledReason={linkBlockReason}
                    reasonShownById={linkBlockReason ? blockReasonId : undefined}
                    onClick={openLinkFlow}
                  >
                    <Link2 size={16} aria-hidden />
                    {previous ? 'Reconnect bank account' : 'Link bank account'}
                  </DisabledReasonButton>
                  {account.is_archived ? (
                    <p id={blockReasonId} className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                      {ARCHIVED_REASON}
                    </p>
                  ) : (
                    linkingPaused && <BankSyncNotSetUp id={blockReasonId} />
                  )}
                </div>
              )}
              {viewKey === 'linked' && link && (
                <LinkedView
                  link={link}
                  balance={status?.balance ?? null}
                  openingAdjustment={status?.opening_adjustment ?? null}
                  currency={account.currency}
                  sync={syncLabel}
                  connection={connections?.find((connection) => connection.id === link.connection_id)}
                  providers={providers}
                  initialFocus={initialFocus}
                  onChooseBankAccount={openLinkFlow}
                  onReviewSettings={() => {
                    setReviewSettingsKey((key) => key + 1)
                    setReviewSettingsOpen(true)
                  }}
                  onUnlink={() => {
                    setUnlinking(link)
                    setUnlinkOpen(true)
                  }}
                />
              )}
            </StepTransition>
          </LoadingRegion>
        )}
      </div>

      {ownPersonal && (
        <BankLinkFlowModal
          key={linkFlowKey}
          open={linkFlowOpen}
          account={account}
          onClose={() => setLinkFlowOpen(false)}
          onExitComplete={restoreLostFocus}
        />
      )}

      {ownPersonal && (
        <ReviewSettingsModal
          key={reviewSettingsKey}
          open={reviewSettingsOpen}
          accountId={account.id}
          level="stacked"
          onClose={() => setReviewSettingsOpen(false)}
        />
      )}

      {unlinking && (
        <UnlinkModal
          open={unlinkOpen}
          account={account}
          link={unlinking}
          connection={connections?.find((connection) => connection.id === unlinking.connection_id)}
          level="stacked"
          onClose={() => setUnlinkOpen(false)}
          onExitComplete={() => {
            setUnlinking(null)
            restoreLostFocus()
          }}
        />
      )}
    </EditModalSection>
  )
}
