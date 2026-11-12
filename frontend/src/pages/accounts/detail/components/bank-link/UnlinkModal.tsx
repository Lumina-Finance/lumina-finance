import { useState } from 'react'
import { Unlink } from 'lucide-react'
import { useNavigate } from 'react-router'
import type { AccountsOverview } from '@/api/accounts'
import { useUnlinkBankAccount, type BankConnection, type BankLink } from '@/api/bank-sync'
import { openBankConnections } from '@/components/bank-link-flow/bankConnectionsRequest'
import { ModalFormFooter } from '@/components/modal/FormFooter'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import { useToast } from '@/hooks/useToast'
import { connectionName } from '@/utils/bankSync'
import { getSaveFailureMessage } from '@/utils/createFailure'

type UnlinkModalProps = {
  open: boolean
  account: AccountsOverview
  link: BankLink

  /** The connection the link goes through, undefined while the connections load or when they fail to */
  connection: BankConnection | undefined
  onClose: () => void

  /** Runs once the account is unlinked, as the dialogue closes, such as to close the edit dialogue under it */
  onUnlinked?: () => void
  onExitComplete: () => void
}

/**
 * Stops one account syncing, keeping its connection for others. Disconnecting the connection itself
 * is done in Settings, which the dialogue says in one line with a link to the connection there. It
 * opens over the account's edit dialogue, so it takes the stacked level
 */
export function UnlinkModal({
  open,
  account,
  link,
  connection,
  onClose,
  onUnlinked,
  onExitComplete,
}: UnlinkModalProps) {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const unlink = useUnlinkBankAccount()
  const [error, setError] = useState<string | null>(null)
  const busy = unlink.isPending
  const name = connection ? connectionName(connection) : link.provider_name

  const confirm = () => {
    setError(null)
    unlink.mutate(account.id, {
      onSuccess: () => {
        showToast({ status: 'success', text: `Unlinked ${account.name}.` })
        onClose()
        onUnlinked?.()
      },
      onError: (cause) => setError(getSaveFailureMessage(cause)),
    })
  }

  const openConnection = () => {
    onClose()
    openBankConnections(navigate, { open: 'connection', connectionId: link.connection_id })
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
          submitLabel="Unlink"
          submitDisabled={busy}
          submitWidthClassName="w-full sm:w-auto"
          tone="danger"
          error={error}
          level="stacked"
          onCancel={onClose}
          onPrimary={confirm}
          primaryOnLeft
        />
      }
    >
      <div className="space-y-2 pb-2">
        <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
          New transactions from the bank stop coming into {account.name}. Unlinking keeps every transaction already in{' '}
          {account.name} and every item waiting for review.
        </p>
        <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
          To disconnect {name} from every account, please open the connection in{' '}
          <button
            type="button"
            className="app-inline-link font-medium underline underline-offset-2 transition-control"
            style={{ color: 'var(--app-text)' }}
            disabled={busy}
            onClick={openConnection}
          >
            Settings
          </button>
          .
        </p>
      </div>
    </ModalTitledPanel>
  )
}
