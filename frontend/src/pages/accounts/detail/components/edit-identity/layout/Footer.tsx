import { Trash2 } from 'lucide-react'
import type { DeleteStage } from '@/pages/accounts/detail/components/edit-identity/types'

type EditModalFooterProps = {
  deleteStage: DeleteStage
  isBusy: boolean
  saveLoading: boolean
  onCancel: () => void
  onStartDelete: () => void
}

/**
 * Renders destructive, cancel, and save actions with shared pending-state rules
 */
export function EditModalFooter({
  deleteStage,
  isBusy,
  saveLoading,
  onCancel,
  onStartDelete,
}: EditModalFooterProps) {
  return (
    <div
      className="flex shrink-0 items-center gap-3 px-6 py-4 sm:px-7 min-[1050px]:py-5"
      style={{ borderTop: '1px solid var(--app-border)' }}
    >
      <button
        type="button"
        className="app-danger-button h-10 w-10 shrink-0 px-0"
        onClick={onStartDelete}
        disabled={isBusy || deleteStage !== 'idle'}
        aria-label="Delete account"
        title="Delete account"
      >
        <Trash2 size={16} aria-hidden />
      </button>
      <div className="ml-auto flex items-center gap-3">
        <button type="button" className="app-secondary-button" onClick={onCancel} disabled={isBusy}>
          Cancel
        </button>
        <button
          type="submit"
          className={`app-primary-button overflow-hidden whitespace-nowrap duration-300 ${saveLoading ? 'app-primary-button-loading' : 'w-36'}`}
          disabled={isBusy || deleteStage !== 'idle'}
        >
          {saveLoading ? <span className="app-spinner" /> : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}
