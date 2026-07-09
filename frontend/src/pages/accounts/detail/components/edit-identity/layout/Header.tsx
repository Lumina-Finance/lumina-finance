import { X } from 'lucide-react'
import type { AccountType } from '@/api/accounts'
import { humanizeAccountType } from '@/pages/accounts/detail/utils/formatAccountType'

type EditModalHeaderProps = {
  accountType: AccountType
  isBusy: boolean
  onClose: () => void
}

/**
 * Renders the modal heading and close control for the edit workflow
 */
export function EditModalHeader({
  accountType,
  isBusy,
  onClose,
}: EditModalHeaderProps) {
  return (
    <div
      className="shrink-0 pb-5 pl-4 pr-5 pt-6 min-[1050px]:px-7"
      style={{ borderBottom: '1px solid var(--app-border)' }}
    >
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <p className="mb-2 text-xs font-semibold uppercase" style={{ color: 'var(--app-accent)' }}>
            {humanizeAccountType(accountType)}
          </p>
          <h2 id="edit-account-identity-title" className="font-serif text-3xl font-normal">
            Edit Account
          </h2>
        </div>
        <button type="button" onClick={onClose} className="app-icon-button shrink-0" aria-label="Close" disabled={isBusy}>
          <X size={20} aria-hidden />
        </button>
      </div>
    </div>
  )
}
