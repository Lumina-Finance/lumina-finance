import { useState } from 'react'
import { Unlink } from 'lucide-react'
import type { AccountsOverview } from '@/api/accounts'
import {
  useBankProviders,
  useDisconnectBankConnection,
  useUnlinkBankAccount,
  type BankConnection,
  type BankLink,
} from '@/api/bank-sync'
import { ChoiceCard } from '@/components/bank-link-flow/ChoiceCard'
import { InfoCallout } from '@/components/InfoCallout'
import { ModalFormFooter } from '@/components/modal/FormFooter'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import { useToast } from '@/hooks/useToast'
import { connectionName, countNoun, credentialNoun, describeDisconnected, providerSiteName } from '@/utils/bankSync'
import { getSaveFailureMessage } from '@/utils/createFailure'

type UnlinkScope = 'account' | 'connection'

type UnlinkModalProps = {
  open: boolean
  account: AccountsOverview
  link: BankLink

  /** The connection the link goes through, undefined while the connections load */
  connection: BankConnection | undefined

  /** Whether reading the connections failed, leaving the connection unknown */
  connectionFailed: boolean
  onClose: () => void
  onExitComplete: () => void
}

/**
 * How many other accounts follow a bank account through the connection, including one waiting for
 * its bank account to be chosen again
 */
function countOtherAccounts(connection: BankConnection, accountId: string): number {
  const linked = new Set([
    ...connection.accounts.flatMap((bankAccount) =>
      bankAccount.linked_account_id ? [bankAccount.linked_account_id] : [],
    ),
    ...connection.choose_again_links.map((waiting) => waiting.account_id),
  ])
  linked.delete(accountId)
  return linked.size
}

/**
 * Stops one account syncing, keeping its connection for others, or disconnects the whole connection,
 * unlinking every account on it and deleting its stored access. It opens over the account's edit
 * dialogue, so it takes the stacked level
 */
export function UnlinkModal({
  open,
  account,
  link,
  connection,
  connectionFailed,
  onClose,
  onExitComplete,
}: UnlinkModalProps) {
  const { showToast } = useToast()
  const unlink = useUnlinkBankAccount()
  const disconnect = useDisconnectBankConnection()
  const [scope, setScope] = useState<UnlinkScope>('account')
  const [error, setError] = useState<string | null>(null)
  const busy = unlink.isPending || disconnect.isPending
  const otherCount = connection ? countOtherAccounts(connection, account.id) : 0
  const site = providerSiteName(link)
  const { data: providers } = useBankProviders()

  // Names the provider's first field, as the connect form's messages do. A provider gone from the
  // server can't be connected again, so the card says nothing of connecting
  const fields = providers?.providers.find((provider) => provider.id === link.provider)?.credential_fields
  const connectAgain = fields ? ` Connecting again needs a new ${credentialNoun(fields[0].label)}.` : ''

  // Why Disconnect can't be chosen while the connection is unknown, printed on its card as the bank link
  // flow's cards print theirs
  const disconnectReason = connection
    ? null
    : connectionFailed
      ? "Couldn't load this connection, so it can't be disconnected right now."
      : 'Loading this connection…'

  const reportError = (cause: unknown) => setError(getSaveFailureMessage(cause))

  const confirm = () => {
    setError(null)
    if (scope === 'account') {
      unlink.mutate(account.id, {
        onSuccess: () => {
          showToast({ status: 'success', text: `${account.name} unlinked.` })
          onClose()
        },
        onError: reportError,
      })
      return
    }
    if (!connection) {
      setError(disconnectReason)
      return
    }
    disconnect.mutate(connection.id, {
      onSuccess: (result) => {
        showToast({ status: 'success', text: describeDisconnected(connection, result.unlinked_account_ids.length) })
        onClose()
      },
      onError: reportError,
    })
  }

  return (
    <ModalTitledPanel
      open={open}
      onClose={onClose}
      onExitComplete={onExitComplete}
      titleId="bank-unlink-title"
      title="Unlink bank account"
      eyebrow={`${link.external_account_name} at ${link.institution_name}`}
      RailIcon={Unlink}
      railLabel="Bank"
      level="stacked"
      closeDisabled={busy}
      footer={
        <ModalFormFooter
          submitLabel={scope === 'account' ? 'Unlink' : 'Disconnect'}
          submitDisabled={busy}
          submitWidthClassName="w-full sm:w-auto"
          fadesLabelChanges
          tone="danger"
          error={error}
          holdsButtonWidth
          level="stacked"
          onCancel={onClose}
          onPrimary={confirm}
          primaryOnLeft
        />
      }
    >
      <div className="space-y-3 pb-2">
        <div className="space-y-3" role="radiogroup" aria-label="What to unlink">
          {/* The dialogue opens on the chosen scope. It comes before Cancel in the dialogue and so takes the
              first focus from it, and arrow keys move between the two from there */}
          <ChoiceCard
            selected={scope === 'account'}
            initialFocus={scope === 'account'}
            disabled={busy}
            onSelect={() => setScope('account')}
          >
            <span className="block text-sm font-medium" style={{ color: 'var(--app-text)' }}>
              Unlink this account
            </span>
            <span className="block text-xs" style={{ color: 'var(--app-text-muted)' }}>
              {otherCount > 0
                ? `The connection stays in Settings for the ${countNoun(otherCount, 'other account')} using it.`
                : 'The connection stays in Settings, ready for this or another account to link again.'}
            </span>
          </ChoiceCard>
          <ChoiceCard
            selected={scope === 'connection'}
            initialFocus={scope === 'connection'}
            disabled={busy || !connection}
            onSelect={() => setScope('connection')}
          >
            <span className="block text-sm font-medium" style={{ color: 'var(--app-text)' }}>
              Disconnect {connection ? connectionName(connection) : link.provider_name}
            </span>
            <span className="block text-xs" style={{ color: 'var(--app-text-muted)' }}>
              {disconnectReason ??
                `Unlinks every account on this connection and deletes the stored access.${connectAgain}`}
            </span>
          </ChoiceCard>
        </div>
        <InfoCallout>
          Transactions already in your ledger stay, and items waiting for review stay until you act on them. To stop{' '}
          {site} sharing data at all, revoke Lumina Finance&apos;s access there too.
        </InfoCallout>
      </div>
    </ModalTitledPanel>
  )
}
