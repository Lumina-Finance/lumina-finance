import { Fragment, useId, useRef, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { ChevronDown, ListChecks } from 'lucide-react'
import { ApiError } from '@/api/auth'
import {
  useApplyBulkApproval,
  useBulkApprovalPreview,
  type BulkApprovalGroup,
  type BulkApprovalKind,
} from '@/api/bank-sync'
import { Unfold } from '@/components/display/Unfold'
import { InfoCallout } from '@/components/InfoCallout'
import LoadFailure from '@/components/errors/LoadFailure'
import LoadingRegion from '@/components/loading/Region'
import { ModalFormFooter } from '@/components/modal/FormFooter'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import { useToast } from '@/hooks/useToast'
import type { ReviewItemAccount } from '@/components/transactions/bank-review/ReviewBlock'
import {
  describeBulkApprovalGroup,
  describeBulkApprovalResult,
  describeExcludedNewItems,
  describeReviewItem,
  formatReviewDate,
  getReviewItemAmount,
} from '@/components/transactions/utils/bankReview'

const APPROVAL_FAILED_MESSAGE = 'Something went wrong. Please try again.'

// A net effect is toned as the list's day totals are: green for money in, red for money out
const netEffectColor = (amount: number) =>
  amount > 0 ? 'var(--app-positive)' : amount < 0 ? 'var(--app-negative)' : 'var(--app-text)'

type BulkApprovalModalProps = {
  open: boolean

  /** The accounts the review block is filtered to, or undefined for every account */
  scope: string[] | undefined
  accountFor: (accountId: string) => ReviewItemAccount

  /** Today as "YYYY-MM-DD" in the user's profile timezone, which decides whether a date shows its year */
  today: string
  onClose: () => void
}

/**
 * What bulk approval would change in the accounts the review block shows, before it applies it: a
 * group for corrections and one for removals, each with its count and its net effect on balances,
 * opening to list its items, and the count of new items that stay waiting
 *
 * Approve applies exactly the items listed, and closes the modal with a toast saying what it applied
 * once the ledger and the block show it. One the bank changed since stays waiting, which turns the
 * toast into an error. A request that fails says why beside the actions, and applies nothing
 */
export function BulkApprovalModal({ open, scope, accountFor, today, onClose }: BulkApprovalModalProps) {
  const titleId = useId()
  const listIdPrefix = useId()
  const { formatMovedCurrency } = useMoneyFormatters()
  const { showToast } = useToast()
  const apply = useApplyBulkApproval()

  // Applied, the preview stays as it is while the modal closes, rather than being read again empty
  const isLocked = apply.isPending || apply.isSuccess
  const {
    data: readPreview,
    error: previewError,
    isFetchedAfterMount,
  } = useBulkApprovalPreview(scope, open && !isLocked)

  // Each opening reads the preview anew, so one cached from before, which may list items decided
  // since, never shows. Nor does one a later read failed to bring up to date
  const isLoading = !isFetchedAfterMount
  const preview = isFetchedAfterMount && !previewError ? readPreview : undefined
  const [expandedKind, setExpandedKind] = useState<BulkApprovalKind | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Approve names how many it applies only once that is known
  const items = preview?.groups.flatMap((group) => group.items) ?? []
  const approveLabel = preview ? `Approve ${items.length.toLocaleString()}` : 'Approve'

  // Set as Approve is pressed, since its pending state renders a moment later, so a second press in
  // between sends nothing
  const isSent = useRef(false)
  const approve = () => {
    if (isSent.current) return
    isSent.current = true
    setError(null)
    apply.mutate(
      { scope, items },
      {
        onSuccess: (result) => {
          showToast(describeBulkApprovalResult(result))
          onClose()
        },
        onError: (cause) => {
          isSent.current = false
          setError(cause instanceof ApiError ? cause.message : APPROVAL_FAILED_MESSAGE)
        },
      },
    )
  }

  const renderGroup = (group: BulkApprovalGroup) => {
    const isExpanded = expandedKind === group.kind
    const listId = `${listIdPrefix}-${group.kind}`
    return (
      <div key={group.kind} className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--app-border)' }}>
        <button
          type="button"
          aria-expanded={isExpanded}
          aria-controls={listId}
          onClick={() => setExpandedKind(isExpanded ? null : group.kind)}
          className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:bg-[var(--app-accent-soft)] motion-reduce:transition-none focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--app-focus-ring)]"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium" style={{ color: 'var(--app-text)' }}>
              {describeBulkApprovalGroup(group.kind, group.count)}
            </span>
            <span className="block font-financial text-xs tabular-nums" style={{ color: 'var(--app-text-muted)' }}>
              {group.net_effect.length === 0 ? (
                'No balance change'
              ) : (
                <>
                  Net effect:{' '}
                  {group.net_effect.map(({ currency, amount }, index) => (
                    <Fragment key={currency}>
                      {index > 0 && ', '}
                      <span style={{ color: netEffectColor(amount) }}>{formatMovedCurrency(amount, currency)}</span>
                    </Fragment>
                  ))}
                </>
              )}
            </span>
          </span>
          <ChevronDown
            size={16}
            aria-hidden
            className={`shrink-0 transition-transform motion-reduce:transition-none ${isExpanded ? 'rotate-180' : ''}`}
            style={{ color: 'var(--app-text-subtle)' }}
          />
        </button>
        <AnimatePresence initial={false}>
          {isExpanded && (
            <Unfold key="items" flush>
              {/* Each row's divider runs over it within the group's padding, as the review block's rows'
                  do, so the first sits right under the heading and each stops short of the edges */}
              <ul id={listId} className="px-4 pb-1">
                {group.items.map((item) => {
                  const amount = getReviewItemAmount(item, accountFor(item.account_id).currency, formatMovedCurrency)
                  return (
                    <li
                      key={item.id}
                      className="flex items-center gap-3 py-2 text-sm"
                      style={{ borderTop: '1px solid var(--app-border)' }}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block break-words" style={{ color: 'var(--app-text)' }}>
                          {item.bank.description}
                        </span>
                        <span className="block text-xs" style={{ color: 'var(--app-text-muted)' }}>
                          {formatReviewDate(item.bank.date, today)} · {describeReviewItem(item)}
                        </span>
                      </span>
                      <span
                        className="shrink-0 font-financial tabular-nums"
                        style={{
                          color: amount.sign > 0 ? 'var(--app-positive)' : 'var(--app-text)',
                          textDecoration: amount.isStruckThrough ? 'line-through' : undefined,
                        }}
                      >
                        {amount.text}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </Unfold>
          )}
        </AnimatePresence>
      </div>
    )
  }

  return (
    <ModalTitledPanel
      open={open}
      onClose={onClose}
      titleId={titleId}
      title="Bulk approve"
      eyebrow="Bank review"
      RailIcon={ListChecks}
      railLabel="Approve"
      closeDisabled={apply.isPending}
      footer={
        <ModalFormFooter
          submitLabel={approveLabel}
          submitLabels={[...new Set(['Approve', approveLabel])]}
          submitDisabled={apply.isPending}
          submitUnavailable={items.length === 0 || apply.isSuccess}
          submitWidthClassName="w-full sm:w-auto"
          error={error}
          onCancel={onClose}
          onPrimary={approve}
          primaryOnLeft
        />
      }
    >
      <LoadingRegion loading={isLoading} label="Working out what would change" animateLoadingHeight>
        <div className="min-h-32 space-y-4 pb-2">
          <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
            Everything below is applied at once. Nothing else in your ledger changes.
          </p>

          {!isLoading && previewError && <LoadFailure error={previewError} subject="Bulk approval" />}

          {preview?.groups.map(renderGroup)}

          {preview && items.length === 0 && (
            <p className="py-4 text-center text-sm italic" style={{ color: 'var(--app-text-muted)' }}>
              Nothing here can be approved in bulk right now.
            </p>
          )}

          {preview && preview.excluded_count > 0 && (
            <InfoCallout>{describeExcludedNewItems(preview.excluded_count)}</InfoCallout>
          )}
        </div>
      </LoadingRegion>
    </ModalTitledPanel>
  )
}
