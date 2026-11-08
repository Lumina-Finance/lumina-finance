import { useId, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { SlidersHorizontal } from 'lucide-react'
import { ApiError } from '@/api/auth'
import {
  useReviewPreferences,
  useUpdateReviewPreferences,
  type ReviewDecision,
  type ReviewPreferences,
} from '@/api/bank-sync'
import { Unfold } from '@/components/display/Unfold'
import LoadFailure from '@/components/errors/LoadFailure'
import { InfoCallout } from '@/components/InfoCallout'
import LoadingRegion from '@/components/loading/Region'
import { ModalFormFooter } from '@/components/modal/FormFooter'
import type { ModalLevel } from '@/components/modal/Shell'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import { ANSWER_FAILED_MESSAGE } from '@/pages/accounts/detail/components/bank-link/openingAdjustment'
import {
  getReviewPreset,
  presetPreferences,
  REVIEW_DECISION_OPTIONS,
  REVIEW_KINDS,
  REVIEW_PRESET_OPTIONS,
  type ReviewPreset,
} from '@/pages/accounts/detail/components/bank-link/reviewSettings'
import TransactionModalPillSelector from '@/components/transactions/transaction-modal/controls/PillSelector'

type ReviewSettingsModalProps = {
  open: boolean
  accountId: string
  level?: ModalLevel
  onClose: () => void
}

/**
 * Whether each kind of bank data arriving for one of the user's own accounts waits for review or is
 * applied as it arrives, chosen as Review all, Auto-approve all or a Custom mix. Saved choices that
 * all match open on their preset, and Custom stays chosen while the dialogue is open, so its rows don't
 * fold away under the pointer as the last one comes to match the others. Nothing changes until Save,
 * and the dialogue opens on what was saved each time, since the section mounts it afresh
 */
export function ReviewSettingsModal({ open, accountId, level = 'page', onClose }: ReviewSettingsModalProps) {
  const titleId = useId()
  const { data: saved, error: readError } = useReviewPreferences(accountId, open)
  const update = useUpdateReviewPreferences()
  const [draft, setDraft] = useState<ReviewPreferences | null>(null)
  const [customChosen, setCustomChosen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = draft ?? saved
  const preset = current && (customChosen ? 'custom' : getReviewPreset(current))

  const choosePreset = (next: ReviewPreset) => {
    setCustomChosen(next === 'custom')
    if (next !== 'custom') setDraft(presetPreferences(next))
  }

  // The rows show only under Custom. A saved mix opens on it without choosing it, so a change here
  // chooses it, keeping the rows open when the change leaves all three alike
  const chooseDecision = (key: keyof ReviewPreferences, decision: ReviewDecision) => {
    if (!current) return
    setCustomChosen(true)
    setDraft({ ...current, [key]: decision })
  }

  const save = () => {
    if (!current) return
    setError(null)
    update.mutate(
      { accountId, preferences: current },
      {
        onSuccess: onClose,
        onError: (cause) => setError(cause instanceof ApiError ? cause.message : ANSWER_FAILED_MESSAGE),
      },
    )
  }

  return (
    <ModalTitledPanel
      open={open}
      onClose={onClose}
      titleId={titleId}
      title="Review settings"
      eyebrow="Bank sync"
      RailIcon={SlidersHorizontal}
      railLabel="Review"
      level={level}
      closeDisabled={update.isPending}
      footer={
        <ModalFormFooter
          submitLabel="Save"
          submitDisabled={update.isPending}
          // Nothing to save until the settings have loaded. A press can't fix that
          submitReason={current ? null : readError ? 'The review settings did not load' : 'Still loading'}
          // As wide as Cancel beside it, since the short label would otherwise fall short of that
          submitWidthClassName="w-full sm:w-21"
          error={error}
          holdsButtonWidth
          level={level}
          onCancel={onClose}
          onPrimary={save}
        />
      }
    >
      {readError && !saved ? (
        <LoadFailure error={readError} subject="Review settings" />
      ) : (
        <LoadingRegion loading={!current} label="Loading review settings" animateLoadingHeight readsLayoutHeight>
          {/* Spaced by padding inside each part rather than margins between them, so the Custom rows
                  fold away with their space and nothing below jumps as they go */}
          <div className="min-h-32 pb-2">
            <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
              Reviewed changes wait above the transaction list. Auto-approved ones are applied as they arrive and can
              change ledger values without a review step.
            </p>
            <div className="pt-4">
              <TransactionModalPillSelector
                value={preset ?? ''}
                options={REVIEW_PRESET_OPTIONS}
                ariaLabel="Review preset"
                onChange={choosePreset}
                disabled={!current || update.isPending}
                compactOnMobile
              />
            </div>
            <AnimatePresence initial={false}>
              {preset === 'custom' && current && (
                <Unfold key="custom">
                  <div className="space-y-3">
                    {REVIEW_KINDS.map((kind) => (
                      <div
                        key={kind.key}
                        className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium" style={{ color: 'var(--app-text)' }}>
                            {kind.label}
                          </p>
                          <p className="text-xs" style={{ color: 'var(--app-text-muted)' }}>
                            {kind.description}
                          </p>
                        </div>
                        {/* Wide enough beside the description for Auto-approve to fit its half on one line */}
                        <div className="shrink-0 sm:w-64">
                          <TransactionModalPillSelector
                            value={current[kind.key]}
                            options={REVIEW_DECISION_OPTIONS}
                            ariaLabel={kind.label}
                            onChange={(decision) => chooseDecision(kind.key, decision)}
                            disabled={update.isPending}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </Unfold>
              )}
            </AnimatePresence>
            <div className="pt-4">
              <InfoCallout>
                New transactions need a merchant and category before they can be added, so they wait for review
                whichever you choose.
              </InfoCallout>
            </div>
          </div>
        </LoadingRegion>
      )}
    </ModalTitledPanel>
  )
}
