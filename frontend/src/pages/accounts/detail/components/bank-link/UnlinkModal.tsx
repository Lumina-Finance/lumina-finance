import { useState } from 'react'
import { Unlink } from 'lucide-react'
import type { AccountsOverview } from '@/api/accounts'
import { ApiError } from '@/api/auth'
import { useDisconnectBankConnection, useUnlinkBankAccount, type BankConnection, type BankLink } from '@/api/bank-sync'
import { ChoiceCard } from '@/components/bank-link-flow/ChoiceCard'
import { InfoCallout } from '@/components/InfoCallout'
import { ModalFormFooter } from '@/components/modal/FormFooter'
import type { ModalLevel } from '@/components/modal/Shell'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import { useToast } from '@/hooks/useToast'
import { connectionName, countNoun, describeDisconnected, providerSite } from '@/utils/bankSync'

type UnlinkScope = 'account' | 'connection'

type UnlinkModalProps = {
  open: boolean
  account: AccountsOverview
  link: BankLink

  /** The connection the link goes through, undefined while the connections load */
  connection: BankConnection | undefined
  level?: ModalLevel
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
 * unlinking every account on it and deleting its stored access
 */
export function UnlinkModal({
  open,
  account,
  link,
  connection,
  level = 'page',
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
  const site = providerSite(link)

  const reportError = (cause: unknown) =>
    setError(cause instanceof ApiError ? cause.message : 'Something went wrong. Please try again.')

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
    if (!connection) return
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
      level={level}
      closeDisabled={busy}
      footer={
        <ModalFormFooter
          submitLabel={scope === 'account' ? 'Unlink' : 'Disconnect'}
          submitDisabled={busy}
          submitWidthClassName="w-full sm:w-auto"
          submitLabels={['Unlink', 'Disconnect']}
          tone="danger"
          error={error}
          level={level}
          onCancel={onClose}
          onPrimary={confirm}
          primaryOnLeft
        />
      }
    >
      <div className="space-y-3 pb-2">
        <div className="space-y-3" role="radiogroup" aria-label="What to unlink">
          {/* The dialog opens on the chosen scope, which comes before Cancel in the dialog and so takes the
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
              Unlinks every account on this connection and deletes the stored access. Connecting again needs a new setup
              token.
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
