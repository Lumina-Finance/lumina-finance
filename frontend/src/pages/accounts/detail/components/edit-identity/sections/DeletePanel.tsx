import { AnimatePresence, motion } from 'motion/react'
import { AlertTriangle, EyeOff } from 'lucide-react'
import type { Account } from '@/api/accounts'
import {
  EDIT_ACCOUNT_IDENTITY_FIELD_IDS,
  EASE,
} from '@/pages/accounts/detail/constants/accountDetail'
import type { DeleteStage } from '../types'

type DeleteAccountPanelProps = {
  account: Account
  deleteStage: DeleteStage
  deleteNameInput: string
  deleteError: string | null
  deleteLoading: boolean
  isBusy: boolean
  canDelete: boolean
  onArchiveInstead: () => void
  onContinue: () => void
  onDelete: () => void
  onNameChange: (value: string) => void
}

/**
 * Renders the destructive delete confirmation flow separately from the account form
 */
export function DeleteAccountPanel({
  account,
  deleteStage,
  deleteNameInput,
  deleteError,
  deleteLoading,
  isBusy,
  canDelete,
  onArchiveInstead,
  onContinue,
  onDelete,
  onNameChange,
}: DeleteAccountPanelProps) {
  return (
    <AnimatePresence initial={false}>
      {deleteStage !== 'idle' && (
        <motion.div
          className="overflow-hidden"
          initial={{ height: 0, marginTop: 0, opacity: 0 }}
          animate={{ height: 'auto', marginTop: 20, opacity: 1 }}
          exit={{ height: 0, marginTop: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: EASE }}
        >
          <motion.div
            layout
            className="rounded-lg px-3 py-2.5"
            style={{
              background: 'var(--app-negative-soft)',
              border: '1px solid var(--app-border)',
            }}
            transition={{ duration: 0.22, ease: EASE }}
          >
            <div className="flex gap-2.5">
              <div
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                style={{ background: 'var(--app-bg)', color: 'var(--app-negative)' }}
              >
                <AlertTriangle size={13} aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-semibold leading-5">
                  Delete {account.name}?
                </p>
                <p className="mt-0.5 text-sm leading-5" style={{ color: 'var(--app-text-muted)' }}>
                  Permanent deletion removes its transactions, budgets, and balance history. Archive it instead
                  if you only want it out of view.
                </p>

                <div className="mt-3 overflow-hidden">
                  <AnimatePresence initial={false} mode="wait">
                    {deleteStage === 'confirm' ? (
                      <motion.div
                        key="confirm"
                        className="overflow-hidden"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.18, ease: EASE }}
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          {!account.is_archived ? (
                            <button
                              type="button"
                              className="inline-flex items-center gap-2 text-sm font-medium"
                              style={{ color: 'var(--app-text-muted)' }}
                              onClick={onArchiveInstead}
                              disabled={isBusy}
                            >
                              <EyeOff size={15} aria-hidden />
                              Archive instead
                            </button>
                          ) : (
                            <span aria-hidden />
                          )}
                          <button
                            type="button"
                            className="app-danger-button justify-center sm:ml-auto"
                            onClick={onContinue}
                            disabled={isBusy}
                          >
                            Continue
                          </button>
                        </div>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="type-name"
                        className="overflow-hidden"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.18, ease: EASE }}
                      >
                        <div>
                          <label
                            htmlFor={EDIT_ACCOUNT_IDENTITY_FIELD_IDS.deleteName}
                            className="mb-1.5 block break-words text-sm leading-5"
                            style={{ color: 'var(--app-text-muted)' }}
                          >
                            Type <strong className="font-semibold">"{account.name}"</strong> to delete.
                          </label>
                          <input
                            id={EDIT_ACCOUNT_IDENTITY_FIELD_IDS.deleteName}
                            className="app-input"
                            value={deleteNameInput}
                            onChange={(event) => {
                              onNameChange(event.target.value)
                            }}
                            onKeyDown={(event) => {
                              if (event.key !== 'Enter') return
                              event.preventDefault()
                              onDelete()
                            }}
                            disabled={isBusy}
                            autoComplete="off"
                          />

                          {deleteError && (
                            <p className="mt-3 text-[0.9375rem] font-medium" style={{ color: 'var(--app-negative)' }}>
                              {deleteError}
                            </p>
                          )}

                          <div className="mt-4 flex justify-end">
                            <button
                              type="button"
                              className={`app-danger-button w-full justify-center min-[1050px]:w-auto ${deleteLoading ? 'app-primary-button-loading' : ''}`}
                              onClick={onDelete}
                              disabled={!canDelete || isBusy}
                            >
                              {deleteLoading ? <span className="app-spinner" /> : 'Delete account'}
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
