import { useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Plus } from 'lucide-react'
import { useAccounts } from '@/api/accounts'
import { isBankSyncNotSetUp, useBankConnections, useBankProviders, type BankConnection } from '@/api/bank-sync'
import { BANK_SYNC_NOT_SET_UP_REASON } from '@/components/bank-link-flow/constants'
import LoadFailure from '@/components/errors/LoadFailure'
import { GlassSearchField } from '@/components/list-controls/GlassSearchField'
import LoadingRegion from '@/components/loading/Region'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'
import { ConnectionModal } from '@/pages/settings/components/bank-connections-section/ConnectionModal'
import { ConnectionRow } from '@/pages/settings/components/bank-connections-section/ConnectionRow'
import { ConnectModal } from '@/pages/settings/components/bank-connections-section/ConnectModal'
import {
  CONNECTION_COLUMNS_CLASS,
  CONNECTION_LIST_HEIGHT_TRANSITION,
} from '@/pages/settings/components/bank-connections-section/constants'
import { matchesConnectionSearch } from '@/pages/settings/components/bank-connections-section/utils'
import SettingsCard from '@/pages/settings/components/Card'
import SettingsSectionHeader from '@/pages/settings/components/SectionHeader'
import { SETTINGS_LIST_LOADING_OVERLAY_CLASS } from '@/pages/settings/components/shared/constants'
import { useMeasuredHeight } from '@/pages/settings/components/shared/hooks/useMeasuredHeight'

/**
 * Settings section listing the user's bank connections, laid out like the tag, merchant and category
 * lists. Connections are added, renamed, reconnected and disconnected there, and their bank accounts
 * linked
 *
 * Only providers the server offers for new connections can be added, and only those connected here
 * rather than from an account's own link flow. A provider no longer offered stays listed for users who
 * already connected it. While bank sync isn't set up, adding a connection and linking a bank account
 * are held back with the reason, since nothing would import or sync what they set up, and existing connections can still
 * be renamed, reconnected and disconnected
 */
export function BankConnectionsSection() {
  const prefersReducedMotion = useReducedMotion()

  // When a claim last ended without the app's answer, so the list is read again while the server may
  // still be saving that connection
  const [claimUnansweredAt, setClaimUnansweredAt] = useState<number | null>(null)
  const { data: connections, error: connectionsError } = useBankConnections({ claimUnansweredAt })
  const { data: providers } = useBankProviders()
  const { data: accounts } = useAccounts()
  const accountNameFor = (accountId: string) => accounts?.find((account) => account.id === accountId)?.name

  const offeredProviders = providers?.may_link
    ? providers.providers.filter((provider) => provider.offered && provider.connects_from === 'settings')
    : []
  const noneOffered = providers !== undefined && offeredProviders.length === 0
  const notSetUp = offeredProviders.length > 0 && isBankSyncNotSetUp(providers)
  // The page shows this section only once the providers have loaded
  const addReason = notSetUp ? BANK_SYNC_NOT_SET_UP_REASON : null

  // Connections are few and already loaded, so the search filters them here rather than on the server
  const [search, setSearch] = useState('')
  const shownConnections = connections?.filter((connection) =>
    matchesConnectionSearch(connection, search, accountNameFor),
  )
  const rowsLayoutKey = shownConnections?.map((connection) => connection.id).join(',') ?? ''

  const { ref: contentRef, height: contentHeight } = useMeasuredHeight<HTMLDivElement>()

  const [connectOpen, setConnectOpen] = useState(false)
  const [connectKey, setConnectKey] = useState(0)

  // Held past the reconnect itself, so the form keeps its wording while it closes
  const [reconnecting, setReconnecting] = useState<BankConnection | null>(null)

  const openConnect = (connection: BankConnection | null) => {
    setReconnecting(connection)
    setConnectKey((key) => key + 1)
    setConnectOpen(true)
  }

  // Held past a disconnect, so the modal keeps showing the connection while it animates out
  const [openConnection, setOpenConnection] = useState<BankConnection | null>(null)
  const [connectionModalOpen, setConnectionModalOpen] = useState(false)
  const shownConnection = connections?.find((connection) => connection.id === openConnection?.id) ?? openConnection

  // The opened row's place in the list, and whether its connection was disconnected. A disconnected
  // row is gone once the modal closes, so focus goes to the row that took its place, the one before it
  // when it was last, or the search when none is left
  const openedIndex = useRef(0)
  const disconnected = useRef(false)
  const sectionRef = useRef<HTMLElement>(null)
  const focusAfterDisconnect = () => {
    const section = sectionRef.current
    const next = shownConnections?.[Math.min(openedIndex.current, shownConnections.length - 1)]
    const row = next ? section?.querySelector<HTMLElement>(`[data-connection-id="${next.id}"] button`) : null
    const target = row ?? section?.querySelector<HTMLElement>('input')
    target?.focus()
  }

  return (
    <section ref={sectionRef} id="bank-connections" className="scroll-mt-18">
      <SettingsSectionHeader
        title="Bank connections"
        description="Connect a bank provider once to reach every bank account you hold with it. Each account then chooses one of them under Bank link."
      />

      <SettingsCard>
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <GlassSearchField
              value={search}
              onValueChange={setSearch}
              placeholder="Find a connection or institution…"
              wrapperClassName="flex-1"
            />
            <DisabledReasonButton
              type="button"
              className="app-primary-button shrink-0"
              disabled={offeredProviders.length === 0}
              disabledReason={addReason}
              onClick={() => openConnect(null)}
            >
              <Plus size={16} aria-hidden />
              Add a connection
            </DisabledReasonButton>
          </div>

          {noneOffered && (
            <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
              No bank provider is open to new connections right now. Existing connections keep working.
            </p>
          )}

          {connectionsError && !connections && <LoadFailure error={connectionsError} subject="Bank connections" />}
          <LoadingRegion
            loading={!connections && !connectionsError}
            label="Loading bank connections"
            overlayClassName={SETTINGS_LIST_LOADING_OVERLAY_CLASS}
          >
            <motion.div
              animate={contentHeight === null || prefersReducedMotion ? undefined : { height: contentHeight }}
              initial={false}
              transition={CONNECTION_LIST_HEIGHT_TRANSITION}
              style={prefersReducedMotion ? undefined : { overflow: 'hidden' }}
            >
              <div ref={contentRef} className={connectionsError && !connections ? undefined : 'min-h-12'}>
                {!shownConnections ? null : shownConnections.length === 0 ? (
                  <p className="py-3 text-center text-sm italic" style={{ color: 'var(--app-text-muted)' }}>
                    {search.trim() ? 'No connections match your search.' : 'No connections yet.'}
                  </p>
                ) : (
                  <>
                    <div
                      className={`hidden gap-x-4 py-3 pl-4 pr-3 min-[750px]:grid ${CONNECTION_COLUMNS_CLASS}`}
                      style={{
                        color: 'var(--app-text-muted)',
                        borderBottom: '1px solid var(--app-border)',
                        background: 'var(--app-surface-soft)',
                      }}
                    >
                      <span className="text-xs font-medium uppercase">Connection</span>
                      <span className="text-xs font-medium uppercase">Bank accounts</span>
                      <span className="text-xs font-medium uppercase">Added</span>
                      <span className="text-xs font-medium uppercase">Status</span>
                    </div>
                    <ul aria-label="Bank connections">
                      <AnimatePresence initial={false}>
                        {shownConnections.map((connection, index) => (
                          <ConnectionRow
                            key={connection.id}
                            connection={connection}
                            layoutKey={rowsLayoutKey}
                            isLast={index === shownConnections.length - 1}
                            prefersReducedMotion={prefersReducedMotion}
                            onOpen={() => {
                              openedIndex.current = index
                              disconnected.current = false
                              setOpenConnection(connection)
                              setConnectionModalOpen(true)
                            }}
                          />
                        ))}
                      </AnimatePresence>
                    </ul>
                  </>
                )}
              </div>
            </motion.div>
          </LoadingRegion>
        </div>
      </SettingsCard>

      {shownConnection && (
        <ConnectionModal
          key={shownConnection.id}
          open={connectionModalOpen}
          connection={shownConnection}
          accountNameFor={accountNameFor}
          onReconnect={() => openConnect(shownConnection)}
          onClose={() => setConnectionModalOpen(false)}
          onDisconnected={() => {
            disconnected.current = true
          }}
          onExitComplete={() => {
            setOpenConnection(null)
            if (disconnected.current) focusAfterDisconnect()
          }}
        />
      )}

      <ConnectModal
        key={connectKey}
        open={connectOpen}
        providers={offeredProviders}
        reconnecting={reconnecting}
        reconnectingProvider={providers?.providers.find((provider) => provider.id === reconnecting?.provider)}
        connections={connections}
        level={reconnecting ? 'stacked' : 'page'}
        onClose={() => setConnectOpen(false)}
        onClaimUnanswered={() => setClaimUnansweredAt(Date.now())}
      />
    </section>
  )
}
