import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { AlertTriangle, Check, PencilLine, RefreshCw, Unplug } from 'lucide-react'
import { useAccounts } from '@/api/accounts'
import { getSaveFailureMessage } from '@/utils/createFailure'
import {
  isBankSyncNotSetUp,
  useBankProviders,
  useDisconnectBankConnection,
  useRenameBankConnection,
  type BankConnection,
  type ConnectionBankAccount,
} from '@/api/bank-sync'
import { BankLinkFlowModal, type BankLinkTarget } from '@/components/bank-link-flow/Modal'
import { SyncStatusDot } from '@/components/display/SyncStatusDot'
import { GlassSearchField } from '@/components/list-controls/GlassSearchField'
import { PendingLabel } from '@/components/loading/PendingLabel'
import { ModalWorkspacePanel } from '@/components/modal/WorkspacePanel'
import IconTooltip from '@/components/tooltips/IconTooltip'
import { LabelWithHint } from '@/components/tooltips/LabelWithHint'
import { useAuth } from '@/hooks/useAuth'
import { useConfirmingClick } from '@/hooks/useConfirmingClick'
import { useRelativeTimeRefresh } from '@/hooks/useRelativeTimeRefresh'
import { useToast } from '@/hooks/useToast'
import { CONTENT_EASE_CURVE, QUICK_EASE_S } from '@/utils/widthEase'
import {
  INSTITUTION_SEARCH_AFTER,
  LINKING_HOLD_MS,
} from '@/pages/settings/components/bank-connections-section/constants'
import { InstitutionList, InstitutionRow } from '@/pages/settings/components/bank-connections-section/InstitutionList'
import { NicknameTitle } from '@/pages/settings/components/bank-connections-section/NicknameTitle'
import {
  countLinkedBankAccounts,
  describeConnectionStatus,
  describeInstitutionAllowance,
  describeRequestBudget,
  describeSignInDetail,
  type AccountNameLookup,
} from '@/pages/settings/components/bank-connections-section/utils'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'
import { countNoun, describeDisconnected, PROVIDER_UNAVAILABLE_DETAIL } from '@/utils/bankSync'
import { DATE_FORMATS, formatDate } from '@/utils/date'

/**
 * One fact about the connection, labelled like the facts in an account's Bank link section, with an
 * optional explanation beside its label
 *
 * The explanation beside the label opens above the fact, and a note beside the value, such as the
 * status's, opens below it. Each goes to the other side of the whole fact where its own has no room,
 * so neither covers the value
 */
function ConnectionFact({
  label,
  hint,
  wide = false,
  children,
}: {
  label: string
  hint?: ReactNode
  wide?: boolean
  children: ReactNode
}) {
  return (
    <div className={`min-w-0 ${wide ? 'sm:max-[1050px]:col-span-2' : ''}`} data-tooltip-subject>
      <dt className="flex items-center gap-1 text-xs font-medium uppercase" style={{ color: 'var(--app-text-muted)' }}>
        <LabelWithHint label={label} hint={hint} hintPlacement="top" />
      </dt>
      <dd className="mt-0.5 min-w-0 text-sm font-medium" style={{ color: 'var(--app-text)' }}>
        {children}
      </dd>
    </div>
  )
}

/**
 * The rolling request count Lumina Finance allows the connection, as a thin meter that turns red once
 * it is spent
 */
function RequestBudgetMeter({
  used,
  limit,
  prefersReducedMotion,
}: {
  used: number
  limit: number
  prefersReducedMotion: boolean | null
}) {
  const exhausted = used >= limit
  return (
    <span
      className="block h-1 overflow-hidden rounded-full"
      style={{ background: 'var(--app-border-strong)' }}
      aria-hidden
    >
      <motion.span
        className="block h-full rounded-full"
        style={{ background: exhausted ? 'var(--app-negative)' : 'var(--app-text-muted)' }}
        initial={false}
        animate={{ width: `${Math.min(used / limit, 1) * 100}%` }}
        transition={{ duration: prefersReducedMotion ? 0 : 0.5, ease: CONTENT_EASE_CURVE }}
      />
    </span>
  )
}

type ConnectionModalProps = {
  open: boolean
  connection: BankConnection
  accountNameFor: AccountNameLookup
  onReconnect: () => void
  onClose: () => void
  onExitComplete: () => void

  /** Runs when the connection has been disconnected, just before the modal closes */
  onDisconnected: () => void
}

/**
 * One connection opened from the settings list, in the workspace modal: the connection keeps its own
 * pane with its status, facts and actions, and its institutions fill the rest, each opening to its bank
 * accounts
 *
 * One credential reaches every bank account on the connection, so a bank account has no health of its
 * own here. The list says which account each one keeps up to date, and links a free one from here too
 *
 * A rename or a disconnect on its way holds the modal open, so what comes of it is said beside the
 * connection it was for
 */
export function ConnectionModal({
  open,
  connection,
  accountNameFor,
  onReconnect,
  onClose,
  onExitComplete,
  onDisconnected,
}: ConnectionModalProps) {
  const prefersReducedMotion = useReducedMotion()
  const { showToast } = useToast()
  const { user } = useAuth()
  const disconnect = useDisconnectBankConnection()
  const rename = useRenameBankConnection()
  const { data: providers } = useBankProviders()
  const { data: accounts } = useAccounts()
  const provider = providers?.providers.find((entry) => entry.id === connection.provider)
  const disconnectButtonRef = useRef<HTMLButtonElement>(null)

  // A press anywhere else disarms it, as the delete button of a transaction does, since a press on a
  // part of the page that takes no focus doesn't blur the button in every browser
  const [confirmingDisconnect, setConfirmingDisconnect] = useConfirmingClick(disconnectButtonRef, disconnect.isPending)
  const [renaming, setRenaming] = useState(false)
  const [query, setQuery] = useState('')

  // The editor's field leaves the page when renaming ends, so focus goes back to Rename rather than
  // falling to the page. Rename is disabled until then, so this waits for it to re-enable
  const renameButtonRef = useRef<HTMLButtonElement>(null)
  const wasRenaming = useRef(false)
  useEffect(() => {
    if (wasRenaming.current && !renaming) renameButtonRef.current?.focus()
    wasRenaming.current = renaming
  }, [renaming])

  // Held past the link flow's close, so it keeps its wording while it animates out
  const [linkTarget, setLinkTarget] = useState<BankLinkTarget | null>(null)
  const [linkFlowOpen, setLinkFlowOpen] = useState(false)
  const [linkFlowKey, setLinkFlowKey] = useState(0)

  // The bank account the flow has just linked, held as linking for a moment at least, and until the
  // refreshed connection carries its account, so the change reads as linking rather than a swap
  const [justLinkedId, setJustLinkedId] = useState<string | null>(null)
  const [holdingLinking, setHoldingLinking] = useState(false)
  const justLinked = connection.accounts.find((bankAccount) => bankAccount.external_id === justLinkedId)
  const linkingExternalId = justLinkedId && (holdingLinking || !justLinked?.linked_account_id) ? justLinkedId : null
  const holdTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(holdTimer.current), [])
  const markLinked = (externalId: string) => {
    setJustLinkedId(externalId)
    setHoldingLinking(true)
    window.clearTimeout(holdTimer.current)
    holdTimer.current = window.setTimeout(() => setHoldingLinking(false), LINKING_HOLD_MS)
  }
  const openLinkFlow = (bankAccount: ConnectionBankAccount, accountId: string) => {
    const account = accounts?.find((candidate) => candidate.id === accountId)
    if (!account) return
    setLinkTarget({ connection, bankAccount, account })
    setLinkFlowKey((key) => key + 1)
    setLinkFlowOpen(true)
  }

  const isRejected = connection.status === 'credential_rejected'

  // A provider removed from the server outranks a rejection, since reconnecting can't fix it
  const isUnavailable = !connection.provider_available
  const isStopped = isRejected || isUnavailable

  // The pane that fills the modal fades into the other when the connection stops or comes back
  const paneFade = {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: { duration: prefersReducedMotion ? 0 : QUICK_EASE_S, ease: CONTENT_EASE_CURVE },
  }
  const status = describeConnectionStatus(connection)
  const statusDetail = describeSignInDetail(connection)
  const institutionCount = new Set(connection.accounts.map((bankAccount) => bankAccount.institution_name)).size
  const { linked: linkedCount, total: bankAccountCount } = countLinkedBankAccounts(connection)
  const { limit: requestLimit, used: requestsUsed } = connection.request_budget
  const institutionLimit = provider?.institution_limit ?? null
  const institutionsInUse = provider?.institutions_in_use ?? []
  const allowance = describeInstitutionAllowance(provider, connection.provider_name)
  useRelativeTimeRefresh(() => describeRequestBudget(connection))

  // Linking waits for the worker that imports the history, while renaming, reconnecting and
  // disconnecting carry on without it
  const linkingPaused = isBankSyncNotSetUp(providers)

  const handleDisconnect = () => {
    if (disconnect.isPending) return
    if (!confirmingDisconnect) {
      setConfirmingDisconnect(true)
      return
    }
    disconnect.mutate(connection.id, {
      onSuccess: (result) => {
        showToast({ status: 'success', text: describeDisconnected(connection, result.unlinked_account_ids.length) })
        onDisconnected()
        onClose()
      },
      onError: (cause) => {
        setConfirmingDisconnect(false)
        showToast({
          status: 'error',
          text: getSaveFailureMessage(cause, 'Could not disconnect. Please try again.'),
        })
      },
    })
  }

  // Two to a row only between 640px and 1050px. There the pane spans the full-screen modal. From 1050px it
  // is a narrow column beside the institutions. The range is bounded both ways so neither width depends on
  // the order Tailwind writes its breakpoints in
  const facts = (
    <dl className="grid grid-cols-1 gap-x-5 gap-y-3.5 sm:max-[1050px]:grid-cols-2">
      <ConnectionFact label="Status">
        <span className="flex items-center gap-2">
          <SyncStatusDot tone={status.tone} />
          {status.label}
          {statusDetail && (
            <IconTooltip
              label="Status details"
              placement="bottom"
              size={12}
              widthClassName="w-max max-w-52"
              avoidsLoneWord
              picksSideOnPress
              staysInSurface
            >
              {statusDetail}
            </IconTooltip>
          )}
        </span>
      </ConnectionFact>
      {connection.nickname && <ConnectionFact label="Provider">{connection.provider_name}</ConnectionFact>}
      <ConnectionFact label="Server">
        <span className="block truncate" title={connection.server_label}>
          {connection.server_label}
        </span>
      </ConnectionFact>
      <ConnectionFact label="Added">
        {formatDate(new Date(connection.created_at), DATE_FORMATS.monthDayYear, user?.tz)}
      </ConnectionFact>
      <ConnectionFact label="Institutions linked" hint={allowance.hint}>
        {allowance.value}
      </ConnectionFact>
      <ConnectionFact label="Requests, 24 hours" wide hint={describeRequestBudget(connection)}>
        {requestLimit === null ? (
          <span className="block">None sent</span>
        ) : (
          <>
            <span className="block tabular-nums">
              {requestsUsed} of {requestLimit}
            </span>
            <span className="mt-1.5 block">
              <RequestBudgetMeter
                used={requestsUsed}
                limit={requestLimit}
                prefersReducedMotion={prefersReducedMotion}
              />
            </span>
          </>
        )}
      </ConnectionFact>
    </dl>
  )

  const actions = (
    <>
      {/* The two share the pane's width equally. Beside the pane the column's narrow width leaves them
          less padding, since Disconnect's label needs the room. Rename shrinks to its icon while the
          disconnect asks for confirmation, so the longer confirming label fits beside it */}
      <button
        ref={renameButtonRef}
        type="button"
        aria-label="Rename"
        className={`app-secondary-button h-9 justify-center overflow-hidden whitespace-nowrap text-sm ${confirmingDisconnect ? 'flex-[0_0_2.25rem] px-0' : 'flex-1 px-3 min-[1050px]:px-1.5'}`}
        disabled={renaming || disconnect.isPending}
        onClick={() => setRenaming(true)}
      >
        <PencilLine size={15} aria-hidden className="shrink-0" />
        {/* The word fades and folds away as the button narrows to its icon, taking the icon's gap with it */}
        <span
          aria-hidden
          className={`overflow-hidden transition-all motion-reduce:transition-none ${confirmingDisconnect ? '-ml-2 max-w-0 opacity-0' : 'max-w-24 opacity-100'}`}
        >
          Rename
        </span>
      </button>
      <button
        ref={disconnectButtonRef}
        type="button"
        aria-label={confirmingDisconnect ? 'Yes, disconnect' : 'Disconnect'}
        aria-busy={disconnect.isPending}
        className={`${confirmingDisconnect || disconnect.isPending ? 'app-danger-button' : 'app-secondary-button hover:bg-[var(--app-negative-soft)]'} relative h-9 flex-1 justify-center overflow-hidden whitespace-nowrap px-3 text-sm min-[1050px]:px-1.5 ${disconnect.isPending ? 'app-primary-button-loading' : ''}`}
        style={
          confirmingDisconnect || disconnect.isPending
            ? undefined
            : { color: 'var(--app-negative)', borderColor: 'var(--app-negative-border)' }
        }
        disabled={disconnect.isPending}
        onClick={handleDisconnect}
        onBlur={() => !disconnect.isPending && setConfirmingDisconnect(false)}
      >
        <PendingLabel
          pending={disconnect.isPending}
          name="Disconnect"
          className="inline-flex items-center gap-2"
          contentKey={confirmingDisconnect ? 'confirm' : 'idle'}
        >
          {confirmingDisconnect ? <Check size={15} aria-hidden /> : <Unplug size={15} aria-hidden />}
          {confirmingDisconnect ? 'Yes, disconnect' : 'Disconnect'}
        </PendingLabel>
      </button>
    </>
  )

  const institutionList = (
    <InstitutionList
      connection={connection}
      institutionLimit={institutionLimit}
      institutionsInUse={institutionsInUse}
      query={isStopped ? '' : query}
      accountNameFor={accountNameFor}
      linkingPaused={linkingPaused}
      linkingExternalId={linkingExternalId}
      onLink={openLinkFlow}
      prefersReducedMotion={prefersReducedMotion}
    />
  )

  // A stopped connection folds its institutions away, so there is nothing to search
  const search = !isStopped && institutionCount > INSTITUTION_SEARCH_AFTER && (
    <GlassSearchField
      value={query}
      onValueChange={setQuery}
      placeholder="Find an institution"
      onKeyDown={(event) => {
        // Clears the field first, so Escape only closes the modal once there is nothing to clear
        if (event.key === 'Escape' && query) {
          event.stopPropagation()
          setQuery('')
        }
      }}
    />
  )

  return (
    <ModalWorkspacePanel
      open={open}
      onClose={onClose}
      closeDisabled={disconnect.isPending || rename.isPending}
      onExitComplete={onExitComplete}
      titleId="bank-connection-title"
      eyebrow="Bank connection"
      title={
        <NicknameTitle
          connection={connection}
          rename={rename}
          titleId="bank-connection-title"
          editing={renaming}
          onEditingChange={setRenaming}
          prefersReducedMotion={prefersReducedMotion}
        />
      }
      facts={facts}
      actions={actions}
      partsLabel={`Institutions · ${linkedCount} of ${countNoun(bankAccountCount, 'bank account')} linked`}
      partsTools={search || undefined}
    >
      <AnimatePresence initial={false} mode="wait">
        {isStopped ? (
          // Nothing in the institutions can be acted on until the connection is back, so the pane gives way
          // to what to do about it, and the institutions fold into one row that still opens to show the links
          <motion.div
            key={isUnavailable ? 'unavailable' : 'rejected'}
            className="flex flex-1 flex-col gap-4"
            {...paneFade}
          >
            <div className="flex flex-1 flex-col items-center justify-center px-2 py-3 text-center sm:px-8 sm:py-6">
              <span
                data-testid="connection-state-tile"
                className="flex h-11 w-11 items-center justify-center rounded-xl"
                style={
                  isUnavailable
                    ? { background: 'var(--app-warning-soft)', color: 'var(--app-warning-text)' }
                    : { background: 'var(--app-negative-soft)', color: 'var(--app-negative)' }
                }
              >
                <AlertTriangle size={20} aria-hidden />
              </span>
              <p className="mt-3.5 font-serif text-2xl leading-8">
                {isUnavailable
                  ? `${connection.provider_name} is no longer available`
                  : `${connection.provider_name} rejected this connection`}
              </p>
              <p className="mt-1.5 max-w-sm text-sm" style={{ color: 'var(--app-text-muted)' }}>
                {isUnavailable
                  ? PROVIDER_UNAVAILABLE_DETAIL
                  : 'Every linked account has stopped syncing. Please reconnect to pick up where syncing stopped.'}
              </p>
              <DisabledReasonButton
                type="button"
                className="app-primary-button mt-4 h-9 justify-center px-4 text-sm"
                disabled={isUnavailable || disconnect.isPending}
                disabledReason={isUnavailable ? PROVIDER_UNAVAILABLE_DETAIL : null}
                onClick={onReconnect}
              >
                <RefreshCw size={14} aria-hidden />
                Reconnect
              </DisabledReasonButton>
            </div>
            <div className="border-y border-[var(--app-border)]">
              <InstitutionRow
                entry={{
                  key: 'folded',
                  name: countNoun(institutionCount, 'institution'),
                  countNote: isUnavailable ? 'Nothing links or syncs here now' : 'Linking resumes after you reconnect',
                  linked: linkedCount,
                  total: bankAccountCount,
                  body: institutionList,
                }}
                defaultOpen={false}
                prefersReducedMotion={prefersReducedMotion}
              />
            </div>
          </motion.div>
        ) : (
          <motion.div key="institutions" className="flex flex-1 flex-col" {...paneFade}>
            {institutionList}
          </motion.div>
        )}
      </AnimatePresence>

      {linkTarget && (
        <BankLinkFlowModal
          key={linkFlowKey}
          open={linkFlowOpen}
          account={linkTarget.account}
          chosen={linkTarget}
          onLinked={() => markLinked(linkTarget.bankAccount.external_id)}
          onClose={() => setLinkFlowOpen(false)}
        />
      )}
    </ModalWorkspacePanel>
  )
}
