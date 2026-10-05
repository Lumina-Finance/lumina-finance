import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Link2, Unlink } from 'lucide-react'
import type { Account } from '@/api/accounts'
import { useBankConnections, type AccountBankLink } from '@/api/bank-sync'
import { GROUP_ACCOUNT_LINK_REASON, LINKING_PAUSED_REASON } from '@/components/bank-link-flow/constants'
import { BankLinkFlowModal } from '@/components/bank-link-flow/Modal'
import LoadFailure from '@/components/errors/LoadFailure'
import LoadingRegion from '@/components/loading/Region'
import { useAuth } from '@/hooks/useAuth'
import { useDisabledReason } from '@/hooks/useDisabledReason'
import { ImportProgress } from '@/pages/accounts/detail/components/bank-link/ImportProgress'
import type { BankSyncLabel } from '@/pages/accounts/detail/components/bank-link/status'
import { SyncFact } from '@/pages/accounts/detail/components/bank-link/SyncFact'
import { UnlinkModal } from '@/pages/accounts/detail/components/bank-link/UnlinkModal'
import { useAccountBankLink } from '@/pages/accounts/detail/components/bank-link/useAccountBankLink'
import { useLingeringImport } from '@/pages/accounts/detail/components/bank-link/useLingeringImport'
import { EditModalSection } from '@/pages/accounts/detail/components/edit-identity/layout/Section'
import { IdentityFacts } from '@/pages/accounts/detail/components/identity/Facts'
import { DATE_FORMATS, formatDate, formatDateLabel } from '@/utils/date'

const ARCHIVED_REASON = 'Archived accounts are read-only'
const LOADING_OVERLAY_CLASS = 'absolute inset-0 z-10 flex items-center justify-center bg-[var(--app-bg)]'
const FADE_EASE = [0.22, 1, 0.36, 1] as const

/**
 * Eases the section's height on a spring when it swaps between its views, so the modal grows rather
 * than snapping. The outgoing view is lifted out of flow while it fades, so the measured height is
 * already the incoming one. Between swaps the height follows the content at once, leaving the parts
 * inside to unfold on their own
 */
function ViewSwap({ viewKey, children }: { viewKey: string; children: ReactNode }) {
  const prefersReducedMotion = useReducedMotion()
  const contentRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | 'auto'>('auto')
  const [swappedKey, setSwappedKey] = useState(viewKey)
  const [easing, setEasing] = useState(false)
  if (swappedKey !== viewKey) {
    setSwappedKey(viewKey)
    setEasing(true)
  }

  useLayoutEffect(() => {
    const node = contentRef.current
    if (!node) return undefined
    const observer = new ResizeObserver(() => setHeight(node.offsetHeight))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <motion.div
      animate={{ height }}
      transition={easing && !prefersReducedMotion ? { type: 'spring', visualDuration: 0.3, bounce: 0 } : { duration: 0 }}
      style={{ overflow: easing ? 'hidden' : 'visible' }}
      onAnimationComplete={() => setEasing(false)}
    >
      <div ref={contentRef} className="relative">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.div
            key={viewKey}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.2 }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

/**
 * Grows a part of the linked view in and out by height, so the section never jumps as it comes and goes
 */
function Unfold({ children }: { children: ReactNode }) {
  const prefersReducedMotion = useReducedMotion()
  return (
    <motion.div
      className="overflow-hidden"
      initial={prefersReducedMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={prefersReducedMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
      transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.24, ease: FADE_EASE }}
    >
      <div className="pt-4">{children}</div>
    </motion.div>
  )
}

/**
 * A live link: its facts and status, the import while one runs, and the actions on the link
 */
function LinkedView({ link, sync, onUnlink }: { link: AccountBankLink; sync: BankSyncLabel; onUnlink: () => void }) {
  const shownImport = useLingeringImport(link.import)

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
        <SyncFact name="Status" sync={sync} />
      </IdentityFacts>

      <AnimatePresence initial={false}>
        {shownImport && (
          <Unfold key="import">
            <ImportProgress progress={shownImport} />
          </Unfold>
        )}
      </AnimatePresence>

      {/* Notices and the bank balance sit here, between the import and the actions */}

      {/* From sm up the link's actions share one row. On phones a full-width action takes a row of its own above them */}
      <div className="flex flex-wrap items-center gap-2 pt-4">
        <button type="button" className="app-secondary-button h-9 justify-center whitespace-nowrap px-3.5 text-sm" onClick={onUnlink}>
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
}

/**
 * The account's bank link in its edit modal: linking it, relinking it after an unlink, its import and
 * status while linked, and unlinking it. Every change here applies at once, not on saving the modal
 */
export function BankLinkSection({ account, sectionNumber }: BankLinkSectionProps) {
  const { user } = useAuth()
  const { ownPersonal, status, statusError, providers, syncLabel } = useAccountBankLink(account)
  const { data: connections } = useBankConnections()
  const [linkFlowOpen, setLinkFlowOpen] = useState(false)
  const [linkFlowKey, setLinkFlowKey] = useState(0)

  // Held past the unlink itself, so the dialog can finish closing once the link is gone
  const [unlinking, setUnlinking] = useState<AccountBankLink | null>(null)
  const [unlinkOpen, setUnlinkOpen] = useState(false)

  const link = status?.link ?? null
  const previous = status?.previous_link ?? null
  const linkingPaused = providers !== undefined && !providers.sync_running
  const linkReason = account.is_archived ? ARCHIVED_REASON : linkingPaused ? LINKING_PAUSED_REASON : null
  const { controlProps, tooltip } = useDisabledReason(linkReason)

  const openLinkFlow = () => {
    setLinkFlowKey((key) => key + 1)
    setLinkFlowOpen(true)
  }

  const viewKey = !ownPersonal ? 'group' : !status ? 'loading' : link ? 'linked' : 'unlinked'

  return (
    <EditModalSection number={sectionNumber} title="Bank link">
      {ownPersonal && statusError && !status
        ? <LoadFailure error={statusError} subject="Bank link" />
        : (
            <LoadingRegion loading={viewKey === 'loading'} label="Loading bank link" animateLoadingHeight overlayClassName={LOADING_OVERLAY_CLASS}>
              <ViewSwap viewKey={viewKey}>
                {viewKey === 'loading' && <div className="min-h-16" />}
                {viewKey === 'group' && (
                  <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>{GROUP_ACCOUNT_LINK_REASON} Its transactions stay manual.</p>
                )}
                {viewKey === 'unlinked' && (
                  <div className="space-y-3">
                    <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                      {previous
                        ? `Previously linked to ${previous.external_account_name} at ${previous.institution_name} through ${previous.provider_name}, until ${formatDate(new Date(previous.unlinked_at), DATE_FORMATS.monthDayYear, user?.tz)}. Reconnecting fetches what the bank reported since then.`
                        : 'Link this account to one of the bank accounts on your connections to bring in its transactions automatically. Everything the bank sends waits for your review before it touches a balance.'}
                    </p>
                    <button type="button" className="app-primary-button" {...controlProps} onClick={openLinkFlow}>
                      <Link2 size={16} aria-hidden />
                      {previous ? 'Reconnect bank account' : 'Link bank account'}
                    </button>
                    {tooltip}
                  </div>
                )}
                {viewKey === 'linked' && link && (
                  <LinkedView
                    link={link}
                    sync={syncLabel}
                    onUnlink={() => {
                      setUnlinking(link)
                      setUnlinkOpen(true)
                    }}
                  />
                )}
              </ViewSwap>
            </LoadingRegion>
          )}

      {ownPersonal && (
        <BankLinkFlowModal
          key={linkFlowKey}
          open={linkFlowOpen}
          account={account}
          level="stacked"
          onClose={() => setLinkFlowOpen(false)}
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
          onExitComplete={() => setUnlinking(null)}
        />
      )}
    </EditModalSection>
  )
}
