import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { AlertTriangle, Check, ChevronRight, PencilLine, RefreshCw, Search, Unplug } from 'lucide-react'
import { useAccounts } from '@/api/accounts'
import { ApiError } from '@/api/auth'
import { useBankProviders, useDisconnectBankConnection, type BankConnection, type ConnectionBankAccount } from '@/api/bank-sync'
import { BankLinkFlowModal, type BankLinkTarget } from '@/components/bank-link-flow/Modal'
import { SyncStatusDot } from '@/components/display/SyncStatusDot'
import { ModalWorkspacePanel } from '@/components/modal/WorkspacePanel'
import IconTooltip from '@/components/tooltips/IconTooltip'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { EASE, INSTITUTION_SEARCH_AFTER, LINKING_HOLD_MS } from '@/pages/settings/components/bank-connections-section/constants'
import { InstitutionList } from '@/pages/settings/components/bank-connections-section/InstitutionList'
import { NicknameTitle } from '@/pages/settings/components/bank-connections-section/NicknameTitle'
import {
  countLinked,
  countNoun,
  describeConnectionStatus,
  describeDisconnected,
  describeInstitutionAllowance,
  describeSignInDetail,
  type AccountNameLookup,
} from '@/pages/settings/components/bank-connections-section/utils'
import { DATE_FORMATS, formatDate } from '@/utils/date'
import { formatRelativeFutureTime } from '@/utils/relativeTime'

/**
 * One fact about the connection, labelled like the facts in an account's Bank link section, with an
 * optional explanation beside its label
 */
function ConnectionFact({ label, hint, wide = false, children }: { label: string; hint?: ReactNode; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`min-w-0 ${wide ? 'sm:col-span-2 min-[1050px]:col-span-1' : ''}`}>
      <dt className="flex items-center gap-1 text-xs font-medium uppercase" style={{ color: 'var(--app-text-subtle)' }}>
        {label}
        {hint && (
          <IconTooltip label={`About ${label.toLowerCase()}`} placement="bottom" size={12}>
            <span className="font-normal normal-case">{hint}</span>
          </IconTooltip>
        )}
      </dt>
      <dd className="mt-0.5 min-w-0 text-sm font-medium" style={{ color: 'var(--app-text)' }}>{children}</dd>
    </div>
  )
}

/**
 * The rolling request count the provider allows the connection, as a thin meter that turns red once
 * it is spent
 */
function RequestBudgetMeter({ connection, prefersReducedMotion }: { connection: BankConnection; prefersReducedMotion: boolean | null }) {
  const { used, limit } = connection.request_budget
  const exhausted = used >= limit
  return (
    <span className="block h-1 overflow-hidden rounded-full" style={{ background: 'var(--app-border-strong)' }} aria-hidden>
      <motion.span
        className="block h-full rounded-full"
        style={{ background: exhausted ? 'var(--app-negative)' : 'var(--app-text-muted)' }}
        initial={false}
        animate={{ width: `${Math.min(used / limit, 1) * 100}%` }}
        transition={{ duration: prefersReducedMotion ? 0 : 0.5, ease: EASE }}
      />
    </span>
  )
}

/**
 * A rejected connection's institutions as one closed row, which still opens to show what each bank
 * account is linked to
 */
function FoldedInstitutions({ count, summary, prefersReducedMotion, children }: { count: number; summary: string; prefersReducedMotion: boolean | null; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const bodyId = useId()

  return (
    <div className="border-y border-[var(--app-border)]">
      <button
        type="button"
        className="group flex w-full items-center gap-2.5 rounded-lg px-1 py-3.5 text-left focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--app-accent)]"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRight size={15} aria-hidden className={`shrink-0 transition-transform duration-150 ${open ? 'rotate-90' : ''}`} style={{ color: 'var(--app-text-subtle)' }} />
        <span className="min-w-0 flex-1 sm:flex sm:items-center sm:justify-between sm:gap-3">
          <span className="block font-semibold transition-colors duration-150 group-hover:text-[var(--app-accent)]" style={{ color: 'var(--app-text)' }}>{countNoun(count, 'institution')}</span>
          <span className="mt-0.5 block text-xs sm:mt-0" style={{ color: 'var(--app-text-muted)' }}>{summary}</span>
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={bodyId}
            className="overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.2, ease: EASE }}
          >
            <div className="pb-3 pl-7 pr-1">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

interface ConnectionModalProps {
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
 */
export function ConnectionModal({ open, connection, accountNameFor, onReconnect, onClose, onExitComplete, onDisconnected }: ConnectionModalProps) {
  const prefersReducedMotion = useReducedMotion()
  const { showToast } = useToast()
  const { user } = useAuth()
  const disconnect = useDisconnectBankConnection()
  const { data: providers } = useBankProviders()
  const { data: accounts } = useAccounts()
  const provider = providers?.providers.find((entry) => entry.id === connection.provider)
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false)
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
  const status = describeConnectionStatus(connection)
  const statusDetail = describeSignInDetail(connection)
  const institutionCount = new Set(connection.accounts.map((bankAccount) => bankAccount.institution_name)).size
  const linkedCount = countLinked(connection.accounts)
  const { limit: requestLimit, used: requestsUsed, available_again_at: availableAgainAt } = connection.request_budget
  const institutionLimit = provider?.institution_limit ?? null
  const institutionsInUse = provider?.institutions_in_use ?? []
  const allowance = describeInstitutionAllowance(provider, connection.provider_name)

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
        showToast({ status: 'error', text: cause instanceof ApiError ? cause.message : 'Could not disconnect. Please try again.' })
      },
    })
  }

  const facts = (
    <dl className="grid grid-cols-1 gap-x-5 gap-y-3.5 sm:grid-cols-2 min-[1050px]:grid-cols-1">
      <ConnectionFact label="Status">
        <span className="flex items-center gap-2">
          <SyncStatusDot tone={status.tone} />
          {status.label}
          {statusDetail && (
            <IconTooltip label="Status details" placement="bottom" size={12}>
              {statusDetail}
            </IconTooltip>
          )}
        </span>
      </ConnectionFact>
      {connection.nickname && <ConnectionFact label="Provider">{connection.provider_name}</ConnectionFact>}
      <ConnectionFact label="Server"><span className="block truncate" title={connection.server_label}>{connection.server_label}</span></ConnectionFact>
      <ConnectionFact label="Added">{formatDate(new Date(connection.created_at), DATE_FORMATS.monthDayYear, user?.tz)}</ConnectionFact>
      <ConnectionFact label="Institutions linked" hint={allowance.hint}>{allowance.value}</ConnectionFact>
      <ConnectionFact
        label="Requests, 24 hours"
        wide
        hint={(
          <>
            {connection.provider_name} allows each connection {requestLimit} requests a day, shared by every account linked through it. Automatic syncs and Sync now both use them.
            {requestsUsed >= requestLimit && availableAgainAt && ` Automatic syncs wait until one frees up ${formatRelativeFutureTime(availableAgainAt)}.`}
          </>
        )}
      >
        <span className="block tabular-nums">{requestsUsed} of {requestLimit}</span>
        <span className="mt-1.5 block"><RequestBudgetMeter connection={connection} prefersReducedMotion={prefersReducedMotion} /></span>
      </ConnectionFact>
    </dl>
  )

  const actions = (
    <>
      {/* Shrinks to its icon while the disconnect asks for confirmation, so the longer confirming label
          fits beside it in the connection's narrow pane */}
      <button
        ref={renameButtonRef}
        type="button"
        aria-label="Rename"
        className={`app-secondary-button h-9 justify-center whitespace-nowrap text-sm ${confirmingDisconnect ? 'w-9 flex-none px-0' : 'flex-1 px-3'}`}
        disabled={renaming || disconnect.isPending}
        onClick={() => setRenaming(true)}
      >
        <PencilLine size={15} aria-hidden />
        {!confirmingDisconnect && 'Rename'}
      </button>
      <button
        type="button"
        aria-label={confirmingDisconnect ? 'Yes, disconnect' : 'Disconnect'}
        aria-busy={disconnect.isPending}
        className={`${confirmingDisconnect || disconnect.isPending ? 'app-danger-button' : 'app-secondary-button hover:bg-[var(--app-negative-soft)]'} relative h-9 flex-1 justify-center overflow-hidden whitespace-nowrap px-3 text-sm duration-300 ${disconnect.isPending ? 'app-primary-button-loading' : ''}`}
        style={confirmingDisconnect || disconnect.isPending ? undefined : { color: 'var(--app-negative)', borderColor: 'var(--app-negative-border)' }}
        disabled={disconnect.isPending}
        onClick={handleDisconnect}
        onBlur={() => !disconnect.isPending && setConfirmingDisconnect(false)}
      >
        {disconnect.isPending ? <div className="app-spinner" /> : (
          <AnimatePresence initial={false} mode="wait">
            <motion.span
              key={confirmingDisconnect ? 'confirm' : 'idle'}
              className="inline-flex items-center gap-2"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.15 }}
            >
              {confirmingDisconnect ? <Check size={15} aria-hidden /> : <Unplug size={15} aria-hidden />}
              {confirmingDisconnect ? 'Yes, disconnect' : 'Disconnect'}
            </motion.span>
          </AnimatePresence>
        )}
      </button>
    </>
  )

  const institutionList = (
    <InstitutionList
      connection={connection}
      institutionLimit={institutionLimit}
      institutionsInUse={institutionsInUse}
      query={isRejected ? '' : query}
      accountNameFor={accountNameFor}
      linkingExternalId={linkingExternalId}
      onLink={openLinkFlow}
      prefersReducedMotion={prefersReducedMotion}
    />
  )

  // A rejected connection folds its institutions away, so there is nothing to search
  const search = !isRejected && institutionCount > INSTITUTION_SEARCH_AFTER && (
    <label className="relative block">
      <Search size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--app-text-subtle)' }} />
      <input
        type="search"
        className="app-input h-9 w-full pl-9 text-sm"
        placeholder="Find an institution"
        aria-label="Find an institution"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          // Clears the field first, so Escape only closes the modal once there is nothing to clear
          if (event.key === 'Escape' && query) {
            event.stopPropagation()
            setQuery('')
          }
        }}
      />
    </label>
  )

  return (
    <ModalWorkspacePanel
      open={open}
      onClose={onClose}
      closeDisabled={disconnect.isPending}
      onExitComplete={onExitComplete}
      titleId="bank-connection-title"
      eyebrow="Bank connection"
      title={<NicknameTitle connection={connection} titleId="bank-connection-title" editing={renaming} onEditingChange={setRenaming} prefersReducedMotion={prefersReducedMotion} />}
      facts={facts}
      actions={actions}
      partsLabel={`Institutions · ${linkedCount} of ${countNoun(connection.accounts.length, 'bank account')} linked`}
      partsTools={search || undefined}
    >
      {isRejected ? (
        // Nothing in the institutions can be acted on until the connection is back, so the pane gives way
        // to what to do about it, and the institutions fold into one row that still opens to show the links
        <div className="flex flex-1 flex-col gap-4">
          <div className="flex flex-1 flex-col items-center justify-center px-2 py-3 text-center sm:px-8 sm:py-6">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: 'var(--app-negative-soft)', color: 'var(--app-negative)' }}>
              <AlertTriangle size={20} aria-hidden />
            </span>
            <p className="mt-3.5 font-serif text-2xl leading-8">{connection.provider_name} rejected this connection</p>
            <p className="mt-1.5 max-w-sm text-sm" style={{ color: 'var(--app-text-muted)' }}>
              Every account on it has stopped syncing. Reconnect it with a new setup token to pick up where it left off.
            </p>
            <button type="button" className="app-primary-button mt-4 h-9 justify-center px-4 text-sm" disabled={disconnect.isPending} onClick={onReconnect}>
              <RefreshCw size={14} aria-hidden />
              Reconnect
            </button>
          </div>
          <FoldedInstitutions
            count={institutionCount}
            summary={`${linkedCount} of ${connection.accounts.length} linked · Linking resumes after you reconnect`}
            prefersReducedMotion={prefersReducedMotion}
          >
            {institutionList}
          </FoldedInstitutions>
        </div>
      ) : institutionList}

      {linkTarget && (
        <BankLinkFlowModal
          key={linkFlowKey}
          open={linkFlowOpen}
          target={linkTarget}
          level="stacked"
          onLinked={() => markLinked(linkTarget.bankAccount.external_id)}
          onClose={() => setLinkFlowOpen(false)}
        />
      )}
    </ModalWorkspacePanel>
  )
}
