import { Trash2 } from 'lucide-react'
import { PendingLabel } from '@/components/loading/PendingLabel'
import { MODAL_INSET_CLASS_NAME } from '@/components/modal/inset'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'
import type { DeleteStage } from '@/pages/accounts/detail/components/edit-identity/types'

type EditModalFooterProps = {
  deleteStage: DeleteStage
  isBusy: boolean
  saveLoading: boolean

  /** Why the form can't be saved, once a press found a problem, which fades Save until it is fixed */
  saveBlockedReason?: string
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
  saveBlockedReason,
  onCancel,
  onStartDelete,
}: EditModalFooterProps) {
  // Saving and starting a delete both wait while the delete confirmation is open
  const deleteInProgressReason =
    !isBusy && deleteStage !== 'idle' ? 'Finish or cancel deleting the account first' : undefined

  return (
    <div
      className={`flex shrink-0 items-center gap-3 py-4 min-[1050px]:py-5 ${MODAL_INSET_CLASS_NAME.stacked}`}
      style={{ borderTop: '1px solid var(--app-border)' }}
    >
      <DisabledReasonButton
        className="app-danger-button h-10 w-10 shrink-0 px-0"
        onClick={onStartDelete}
        disabled={isBusy}
        disabledReason={deleteInProgressReason}
        aria-label="Delete account"
        hint="Delete account"
      >
        <Trash2 size={16} aria-hidden />
      </DisabledReasonButton>
      <div className="ml-auto flex items-center gap-3">
        <button type="button" className="app-secondary-button" onClick={onCancel} disabled={isBusy}>
          Cancel
        </button>
        <DisabledReasonButton
          type="submit"
          data-testid="account-submit"
          aria-label="Save changes"
          aria-busy={saveLoading}
          className={`app-primary-button overflow-hidden whitespace-nowrap${saveLoading ? ' app-primary-button-loading' : ' w-36'}`}
          disabled={isBusy}
          disabledReason={deleteInProgressReason ?? (isBusy ? undefined : saveBlockedReason)}
        >
          <PendingLabel pending={saveLoading} name="Save changes">
            Save changes
          </PendingLabel>
        </DisabledReasonButton>
      </div>
    </div>
  )
}
