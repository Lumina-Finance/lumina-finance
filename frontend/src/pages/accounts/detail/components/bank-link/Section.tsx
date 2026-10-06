import { useEffect, useId, useRef, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { Link2, PauseCircle, TriangleAlert, Unlink } from 'lucide-react'
import { useNavigate } from 'react-router'
import type { Account } from '@/api/accounts'
import { REVIEW_PAUSE_COUNT, REVIEW_RESUME_COUNT, useBankConnections, type BankLink, type BankSyncState } from '@/api/bank-sync'
import { BANK_CONNECTIONS_SETTINGS_PATH, GROUP_ACCOUNT_LINK_REASON, LINKING_PAUSED_REASON } from '@/components/bank-link-flow/constants'
import { BankLinkFlowModal } from '@/components/bank-link-flow/Modal'
import { Unfold } from '@/components/display/Unfold'
import LoadFailure from '@/components/errors/LoadFailure'
import { InfoCallout } from '@/components/InfoCallout'
import LoadingRegion from '@/components/loading/Region'
import { StepTransition } from '@/components/two-factor/StepTransition'
import { useAuth } from '@/hooks/useAuth'
import { getDisabledControlProps, useDisabledReason } from '@/hooks/useDisabledReason'
import { ImportProgress } from '@/pages/accounts/detail/components/bank-link/ImportProgress'
import type { BankSyncLabel } from '@/pages/accounts/detail/components/bank-link/status'
import { SyncFact } from '@/pages/accounts/detail/components/bank-link/SyncFact'
import { UnlinkModal } from '@/pages/accounts/detail/components/bank-link/UnlinkModal'
import { useAccountBankLink } from '@/pages/accounts/detail/components/bank-link/useAccountBankLink'
import { useLingeringImport } from '@/pages/accounts/detail/components/bank-link/useLingeringImport'
import { EditModalSection } from '@/pages/accounts/detail/components/edit-identity/layout/Section'
import { IdentityFacts } from '@/pages/accounts/detail/components/identity/Facts'
import { providerSite } from '@/utils/bankSync'
import { DATE_FORMATS, formatDate, formatDateLabel } from '@/utils/date'

const ARCHIVED_REASON = 'Archived accounts are read-only'
const LOADING_OVERLAY_CLASS = 'absolute inset-0 z-10 flex items-center justify-center bg-[var(--app-bg)]'
const NOTICE_ACTION_CLASS = 'app-primary-button h-9 w-full justify-center whitespace-nowrap px-4 text-sm sm:w-auto'

// Long enough for the modal to have opened and put focus in its first field
const OPENING_FOCUS_DELAY_MS = 260

/** Marks the control the modal focuses as it opens, in place of its first field */
type InitialFocusProps = { 'data-modal-field-tab-stop'?: 'true'; 'data-modal-initial-focus'?: 'true' }

// Marks each view's actions, the first of which takes focus when the view swaps in, ahead of the
// Sync details icon among the facts above them
const ACTION_ATTRIBUTE = 'data-bank-link-action'
const ACTION_PROPS = { [ACTION_ATTRIBUTE]: 'true' }

// The states that are the import's own, the only ones its progress shows under, so a retry or a stop
// holding the import never reads as importing
const IMPORT_STATES: ReadonlySet<BankSyncState> = new Set(['importing', 'import_waiting_on_budget'])

type LinkedViewProps = {
  link: BankLink
  sync: BankSyncLabel
  initialFocus: InitialFocusProps
  onChooseBankAccount: () => void
  onUnlink: () => void
}

/**
 * A live link: its facts and status, the import while it is the status, a notice for anything holding
 * its sync back, and the actions on the link. A notice's own action comes first, since it is what
 * resumes the sync. The server leaves the review notices out while only the user can restart the
 * sync, so a stop's notice shows alone
 */
function LinkedView({ link, sync, initialFocus, onChooseBankAccount, onUnlink }: LinkedViewProps) {
  const navigate = useNavigate()
  const shownImport = useLingeringImport(link.import)
  const { state, paused, review_warning: warned } = link.sync
  const waiting = link.sync.waiting_new_count.toLocaleString()

  // An import that has just ended stays a moment as done, whatever the status has moved on to
  const showsImport = shownImport !== null && (shownImport.state === 'complete' || IMPORT_STATES.has(state))

  return (
    <div>
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
        {state === 'reconnect_needed' && (
          <Unfold key="reconnect">
            <InfoCallout
              tone="stopped"
              icon={TriangleAlert}
              action={(
                <button type="button" className={NOTICE_ACTION_CLASS} {...ACTION_PROPS} {...initialFocus} onClick={() => navigate(BANK_CONNECTIONS_SETTINGS_PATH)}>
                  Open settings
                </button>
              )}
            >
              {providerSite(link)} rejected the connection this account uses. Automatic sync is stopped for every account on it until you reconnect it in Settings with a new setup token.
            </InfoCallout>
          </Unfold>
        )}
        {state === 'choose_account' && (
          <Unfold key="choose-account">
            <InfoCallout
              tone="stopped"
              icon={TriangleAlert}
              action={(
                <button type="button" className={NOTICE_ACTION_CLASS} {...ACTION_PROPS} {...initialFocus} onClick={onChooseBankAccount}>
                  Choose bank account
                </button>
              )}
            >
              {link.provider_name} now lists {link.external_account_name} differently, so Lumina Finance can't tell whether it's the same account. Choose its bank account again to resume syncing.
            </InfoCallout>
          </Unfold>
        )}
        {state === 'bank_signin_needed' && (
          <Unfold key="bank-sign-in">
            <InfoCallout tone="stopped" icon={TriangleAlert}>Sign in to your bank again in {providerSite(link)}.</InfoCallout>
          </Unfold>
        )}
        {paused && (
          <Unfold key="paused">
            <InfoCallout tone="review" icon={PauseCircle}>
              Sync is paused with {waiting} new items waiting for review. It resumes on its own once {REVIEW_RESUME_COUNT} or fewer are left.
            </InfoCallout>
          </Unfold>
        )}
        {warned && (
          <Unfold key="warning">
            <InfoCallout tone="review" icon={TriangleAlert}>{waiting} new to review. Sync pauses at {REVIEW_PAUSE_COUNT}.</InfoCallout>
          </Unfold>
        )}
      </AnimatePresence>

      {/* The bank balance goes here */}

      {/* The link's actions, in one row that wraps */}
      <div className="flex flex-wrap items-center gap-2 pt-4">
        <button type="button" className="app-secondary-button h-9 justify-center whitespace-nowrap px-3.5 text-sm" {...ACTION_PROPS} {...initialFocus} onClick={onUnlink}>
          <Unlink size={14} aria-hidden />
          Unlink
        </button>
      </div>
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
 * Focuses the first action inside the element, if it holds one
 */
function focusFirstAction(container: HTMLElement | null) {
  container?.querySelector<HTMLElement>(`[${ACTION_ATTRIBUTE}]`)?.focus({ preventScroll: true })
}

/**
 * The account's bank link in its edit modal: linking it, relinking it after an unlink, its import and
 * status while linked, and unlinking it. Every change here applies at once, not on saving the modal
 */
export function BankLinkSection({ account, sectionNumber, autoFocus = false }: BankLinkSectionProps) {
  const { user } = useAuth()
  const { ownPersonal, status, statusError, providers, syncLabel } = useAccountBankLink(account)
  const { data: connections } = useBankConnections()
  const [linkFlowOpen, setLinkFlowOpen] = useState(false)
  const [linkFlowKey, setLinkFlowKey] = useState(0)

  // Held past the unlink itself, so the dialog can finish closing once the link is gone
  const [unlinking, setUnlinking] = useState<BankLink | null>(null)
  const [unlinkOpen, setUnlinkOpen] = useState(false)

  const link = status?.link ?? null
  const previous = status?.previous_link ?? null
  const linkingPaused = providers !== undefined && !providers.sync_running
  // Archiving lasts, so its reason sits beside the button. A pause passes, so it waits in a tooltip
  const archivedReasonId = useId()
  const { controlProps: pausedProps, tooltip } = useDisabledReason(!account.is_archived && linkingPaused ? LINKING_PAUSED_REASON : null)
  const controlProps = account.is_archived ? getDisabledControlProps(archivedReasonId) : pausedProps

  const openLinkFlow = () => {
    setLinkFlowKey((key) => key + 1)
    setLinkFlowOpen(true)
  }

  const viewKey = !ownPersonal ? 'group' : !status ? 'loading' : link ? 'linked' : 'unlinked'
  const contentRef = useRef<HTMLDivElement>(null)
  const showsControls = viewKey === 'linked' || viewKey === 'unlinked'
  const initialFocus: InitialFocusProps = autoFocus ? { 'data-modal-field-tab-stop': 'true', 'data-modal-initial-focus': 'true' } : {}

  // The modal focuses the marked control as it opens. One that shows only once the link has loaded
  // misses that, so it waits for the modal to have opened and put focus in its first field instead
  const [focusOnShow, setFocusOnShow] = useState(autoFocus && !showsControls)
  useEffect(() => {
    if (!focusOnShow || !showsControls) return undefined
    const timer = window.setTimeout(() => {
      setFocusOnShow(false)
      focusFirstAction(contentRef.current)
    }, OPENING_FOCUS_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [focusOnShow, showsControls])

  // Linking and unlinking swap the view, taking away the control the dialog opened from, so focus would
  // fall to the page once the dialog or the old view has gone. It moves to the new view's action
  // instead, after the dialog has put focus back wherever it still could
  const restoreLostFocus = () => {
    window.requestAnimationFrame(() => {
      if (document.activeElement === null || document.activeElement === document.body) focusFirstAction(contentRef.current)
    })
  }

  return (
    <EditModalSection number={sectionNumber} title="Bank link">
      <div ref={contentRef}>
      {ownPersonal && statusError && !status
        ? <LoadFailure error={statusError} subject="Bank link" />
        : (
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
                  <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>{GROUP_ACCOUNT_LINK_REASON} Its transactions stay manual.</p>
                )}
                {/* The reason a pause gives for Link bank account keeps to the section's sides. The Sync
                    details in the linked view take the room the modal has, which a short section lacks */}
                {viewKey === 'unlinked' && (
                  <div className="space-y-3" data-tooltip-bounds>
                    <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                      {previous
                        ? `Previously linked to ${previous.external_account_name} at ${previous.institution_name} through ${previous.provider_name}, until ${formatDate(new Date(previous.unlinked_at), DATE_FORMATS.monthDayYear, user?.tz)}. Reconnecting fetches what the bank reported since then.`
                        : 'Link this account to one of the bank accounts on your connections to bring in its transactions automatically. Everything the bank sends waits for your review before it touches a balance.'}
                    </p>
                    <button type="button" className="app-primary-button" {...ACTION_PROPS} {...initialFocus} {...controlProps} onClick={openLinkFlow}>
                      <Link2 size={16} aria-hidden />
                      {previous ? 'Reconnect bank account' : 'Link bank account'}
                    </button>
                    {account.is_archived && (
                      <p id={archivedReasonId} className="text-sm" style={{ color: 'var(--app-text-muted)' }}>{ARCHIVED_REASON}</p>
                    )}
                    {tooltip}
                  </div>
                )}
                {viewKey === 'linked' && link && (
                  <LinkedView
                    link={link}
                    sync={syncLabel}
                    initialFocus={initialFocus}
                    onChooseBankAccount={openLinkFlow}
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
