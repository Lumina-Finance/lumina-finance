import { useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { Link2, Unlink } from 'lucide-react'
import type { Account } from '@/api/accounts'
import { useBankConnections, type AccountBankLink } from '@/api/bank-sync'
import { GROUP_ACCOUNT_LINK_REASON, LINKING_PAUSED_REASON } from '@/components/bank-link-flow/constants'
import { BankLinkFlowModal } from '@/components/bank-link-flow/Modal'
import { Unfold } from '@/components/display/Unfold'
import LoadFailure from '@/components/errors/LoadFailure'
import LoadingRegion from '@/components/loading/Region'
import { StepTransition } from '@/components/two-factor/StepTransition'
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
              <StepTransition stepKey={viewKey} easeContentChanges={false}>
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
              </StepTransition>
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
