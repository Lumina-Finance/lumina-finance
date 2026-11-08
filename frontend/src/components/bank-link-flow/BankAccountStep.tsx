import type { AccountsOverview } from '@/api/accounts'
import type { BankConnection, DiscoveredBankAccount, DiscoveredBankAccounts } from '@/api/bank-sync'
import { ChoiceCard } from '@/components/bank-link-flow/ChoiceCard'
import { LINK_FLOW_FIELD_IDS } from '@/components/bank-link-flow/constants'
import type { LinkFlowMode, PreviousBankAccount } from '@/components/bank-link-flow/wording'
import Dropdown, { type DropdownOption } from '@/components/dropdown/Dropdown'
import LoadFailure from '@/components/errors/LoadFailure'
import { FieldError } from '@/components/forms/FieldError'
import { InfoCallout } from '@/components/InfoCallout'
import LoadingRegion from '@/components/loading/Region'
import { useAuth } from '@/hooks/useAuth'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import { connectionName, countNoun, providerSiteName } from '@/utils/bankSync'
import { DATE_FORMATS, formatDate } from '@/utils/date'

const LOADING_OVERLAY_CLASS = 'absolute inset-0 z-10 flex items-center justify-center bg-[var(--app-bg)]'
const CONNECTION_LABEL_ID = 'bank-link-connection-label'

type BankAccountStepProps = {
  account: AccountsOverview
  mode: LinkFlowMode
  previous: PreviousBankAccount | null

  /** The user's connections that can link, offered in a dropdown when there is more than one */
  connections: BankConnection[]
  connection: BankConnection
  onConnectionChange: (connectionId: string) => void
  discovered: DiscoveredBankAccounts | undefined
  discoveredError: Error | null
  chosenId: string | null
  onChoose: (externalId: string) => void

  /** What a refused press found wrong with the choice, shown under the list */
  error?: string
  disabled: boolean
  onOpenSettings: () => void
}

/**
 * Names a connection by its nickname or provider, with the provider under a nickname, how many bank
 * accounts it reaches and when it was added
 */
function describeConnection(connection: BankConnection, timeZone: string | undefined): DropdownOption {
  const provider = connection.nickname ? `${connection.provider_name} · ` : ''
  const added = formatDate(new Date(connection.created_at), DATE_FORMATS.monthDayYear, timeZone)
  return {
    value: connection.id,
    label: connectionName(connection),
    description: `${provider}${countNoun(connection.accounts.length, 'bank account')} · added ${added}`,
  }
}

/**
 * Notes a listed bank account that looks like the one the account followed before: the same one, or
 * one under the same name. After a reconnect that may be the same account listed differently
 */
function describeLikeBefore(entry: DiscoveredBankAccount, previous: PreviousBankAccount | null): string {
  if (!previous) return ''
  if (entry.external_id === previous.externalAccountId) return ' · Same account as before'
  return entry.name === previous.name ? ' · Same name as before' : ''
}

/**
 * Chooses the bank account an account follows, from one of the user's connections. Bank accounts that
 * can't take it are listed with the server's reason, so a missing one is never a mystery
 */
export function BankAccountStep({
  account,
  mode,
  previous,
  connections,
  connection,
  onConnectionChange,
  discovered,
  discoveredError,
  chosenId,
  onChoose,
  error,
  disabled,
  onOpenSettings,
}: BankAccountStepProps) {
  const { user } = useAuth()
  const { formatCurrency } = useMoneyFormatters()

  // A refused press brings focus to the first bank account that can be chosen
  const firstLinkableId = discovered?.accounts.find((entry) => entry.linkable)?.external_id

  return (
    <div className="space-y-3">
      {previous && (
        <InfoCallout>
          {mode === 'choose_again'
            ? `${previous.providerName} now lists ${previous.name} at ${previous.institution} differently. Check the name and balance, then choose the bank account ${account.name} should follow.`
            : `Previously linked to ${previous.name} at ${previous.institution}. After a reconnect, ${previous.providerName} can list the same bank account differently, so check the name and balance before continuing.`}
        </InfoCallout>
      )}
      {connections.length > 1 && (
        <div>
          <span
            id={CONNECTION_LABEL_ID}
            className="mb-1.5 block text-sm font-medium"
            style={{ color: 'var(--app-text)' }}
          >
            Connection
          </span>
          <Dropdown
            labelledBy={CONNECTION_LABEL_ID}
            options={connections.map((entry) => describeConnection(entry, user?.tz))}
            value={connection.id}
            disabled={disabled}
            onChange={onConnectionChange}
          />
        </div>
      )}
      {/* A connection's first listing can still be running, and polls until it arrives */}
      {discoveredError && !discovered ? (
        <LoadFailure error={discoveredError} subject="Bank accounts" />
      ) : discovered?.accounts.length === 0 ? (
        <p
          className="py-6 text-center text-sm"
          role={discovered.discovery_pending ? 'status' : undefined}
          style={{ color: 'var(--app-text-muted)' }}
        >
          {discovered.discovery_pending
            ? 'Listing the bank accounts…'
            : `${providerSiteName(connection)} returned no bank accounts for this connection.`}
        </p>
      ) : (
        <LoadingRegion
          loading={!discovered}
          label="Loading bank accounts"
          animateLoadingHeight
          overlayClassName={LOADING_OVERLAY_CLASS}
        >
          <div
            className={`space-y-3 ${discovered ? '' : 'min-h-32'}`}
            role="radiogroup"
            aria-label="Bank account"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? LINK_FLOW_FIELD_IDS.bankAccountError : undefined}
          >
            {discovered?.accounts.map((entry) => (
              <ChoiceCard
                key={entry.external_id}
                id={entry.external_id === firstLinkableId ? LINK_FLOW_FIELD_IDS.bankAccount : undefined}
                selected={chosenId === entry.external_id}
                disabled={disabled || !entry.linkable}
                onSelect={() => onChoose(entry.external_id)}
              >
                <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="text-sm font-medium" style={{ color: 'var(--app-text)' }}>
                    {entry.name}
                  </span>
                  {/* A currency of the provider's own has no format to show its balance in. Pushed right,
                          so a long name wrapping it onto its own line leaves it at the edge */}
                  {entry.balance !== null && entry.unavailable_reason !== 'custom_currency' && (
                    <span className="ml-auto text-sm tabular-nums" style={{ color: 'var(--app-text)' }}>
                      {formatCurrency(entry.balance, entry.currency)}
                    </span>
                  )}
                </span>
                <span className="block text-xs" style={{ color: 'var(--app-text-muted)' }}>
                  {entry.institution_name}
                  {describeLikeBefore(entry, previous)}
                </span>
                {entry.unavailable_message && (
                  <span className="mt-1 block text-xs" style={{ color: 'var(--app-negative)' }}>
                    {entry.unavailable_message}
                  </span>
                )}
                {entry.linkable && entry.institution_differs && (
                  <span className="mt-1 block text-xs" style={{ color: 'var(--app-warning-text)' }}>
                    The institution differs from the one on {account.name}. That can be normal for a card issued through
                    another bank.
                  </span>
                )}
              </ChoiceCard>
            ))}
          </div>
        </LoadingRegion>
      )}
      <FieldError message={error} id={LINK_FLOW_FIELD_IDS.bankAccountError} />
      <p className="text-xs" style={{ color: 'var(--app-text-muted)' }}>
        Missing a bank account? Add it in {providerSiteName(connection)}, or add another connection in{' '}
        <button
          type="button"
          className="font-medium underline underline-offset-2"
          style={{ color: 'var(--app-text)' }}
          onClick={onOpenSettings}
        >
          Settings
        </button>
        .
      </p>
    </div>
  )
}
