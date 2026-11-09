import { useId, useState } from 'react'
import { Landmark, Lock } from 'lucide-react'
import { getSaveFailureMessage } from '@/utils/createFailure'
import {
  useResolveReviewItem,
  type BankReviewItem,
  type BankValues,
  type CorrectableBankField,
  type ReviewResolution,
} from '@/api/bank-sync'
import { MODAL_INSET_CLASS_NAME } from '@/components/modal/inset'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import { useToast } from '@/hooks/useToast'
import { ReviewDecisionButton } from '@/components/transactions/bank-review/DecisionButton'
import { FormError } from '@/components/forms/FormError'
import { formatRawAmount } from '@/components/transactions/utils/bankReview'
import { formatDateLabel } from '@/utils/date'

// The rows the comparison lists, in the order the transaction modal shows its fields
const COMPARED_FIELDS: [CorrectableBankField, string][] = [
  ['date', 'Date'],
  ['amount', 'Amount'],
  ['description', 'Bank description'],
]

type Decision = {
  resolution: ReviewResolution
  label: string
  toast: string
}

// Each kind's two decisions: the one leaving the ledger as it is, then the one the bank asks for
const DECISIONS: Record<'correction' | 'removal', { keep: Decision; apply: Decision }> = {
  correction: {
    keep: { resolution: 'keep-current', label: 'Keep current value', toast: 'Current values kept.' },
    apply: { resolution: 'accept-change', label: 'Accept bank change', toast: 'Bank change applied.' },
  },
  removal: {
    keep: { resolution: 'keep-transaction', label: 'Keep transaction', toast: 'Transaction kept.' },
    apply: {
      resolution: 'remove-from-ledger',
      label: 'Remove from ledger',
      toast: 'Transaction removed from the ledger.',
    },
  },
}

// Cell padding that keeps the table's outer cells clear of its border and the columns apart
const CELL_CLASS_NAME = 'px-1.5 text-left align-top first:pl-4 last:pr-4'

type BankComparisonModalProps = {
  open: boolean

  /** A correction or a removal. It keeps showing while the modal closes after it is decided */
  item: BankReviewItem

  /** The currency of the item's account. Both its amounts are in it */
  currency: string
  onClose: () => void
}

/**
 * A bank correction or removal beside the ledger transaction it is about, field by field, with the
 * two decisions on it
 *
 * A correction tints each row the bank changed, and notes under a changed value the user had edited
 * that accepting replaces it, and under a value the user kept apart from the bank's that accepting
 * leaves it. A removal changes no value, so its bank column only says the bank no longer reports the
 * transaction. Focus starts on the decision that keeps the ledger as it is. A decision closes the
 * modal with its toast once the ledger and the review block show it, and one that fails says why in
 * the modal, leaving the item waiting
 */
export function BankComparisonModal({ open, item, currency, onClose }: BankComparisonModalProps) {
  const titleId = useId()
  const { formatMovedCurrency } = useMoneyFormatters()
  const { showToast } = useToast()
  const resolve = useResolveReviewItem()
  const [error, setError] = useState('')

  const isRemoval = item.kind === 'removal'
  const { keep, apply } = DECISIONS[isRemoval ? 'removal' : 'correction']
  const pendingResolution = resolve.isPending ? resolve.variables.resolution : undefined

  // A decided item stays on screen while the modal closes, and can't be decided again
  const isLocked = resolve.isPending || resolve.isSuccess

  const formatValue = (field: CorrectableBankField, values: BankValues | null): string => {
    if (!values) return '—'
    if (field === 'date') return formatDateLabel(values.date)
    if (field === 'description') return values.description

    // An amount the currency can't hold is shown exactly as the bank sent it, never rounded
    return values.amount === null
      ? formatRawAmount(values.raw_amount ?? '', currency).text
      : formatMovedCurrency(values.amount, currency)
  }

  const decide = ({ resolution, toast }: Decision) => {
    setError('')
    resolve.mutate(
      { itemId: item.id, resolution, accountId: item.account_id },
      {
        onSuccess: () => {
          showToast({ status: 'success', text: toast })
          onClose()
        },
        onError: (cause) => setError(getSaveFailureMessage(cause)),
      },
    )
  }

  return (
    <ModalTitledPanel
      open={open}
      onClose={onClose}
      titleId={titleId}
      title={isRemoval ? 'Review bank removal' : 'Review bank change'}
      eyebrow={`${isRemoval ? 'Removal' : 'Correction'} from ${item.provider_name}`}
      RailIcon={Landmark}
      railLabel="Review"
      closeDisabled={resolve.isPending}
      keepsToastClear
      footer={
        // The action that changes the ledger sits on the left and the keeping one on the right, as in the
        // other confirmations, and each takes half the width on phones
        <div
          className={`grid shrink-0 grid-cols-2 gap-3 py-4 sm:flex sm:items-center sm:justify-between min-[1050px]:py-5 ${MODAL_INSET_CLASS_NAME.page}`}
          style={{ borderTop: '1px solid var(--app-border)' }}
        >
          <ReviewDecisionButton
            label={apply.label}
            tone={isRemoval ? 'danger' : 'primary'}
            loading={pendingResolution === apply.resolution}
            disabled={isLocked}
            onClick={() => decide(apply)}
          />
          <ReviewDecisionButton
            label={keep.label}
            tone="secondary"
            initialFocus
            loading={pendingResolution === keep.resolution}
            disabled={isLocked}
            onClick={() => decide(keep)}
          />
        </div>
      }
    >
      <div className="space-y-5 pb-2">
        <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
          {isRemoval
            ? `${item.provider_name} no longer reports this transaction. It stays in your ledger unless you remove it.`
            : `${item.provider_name} sent new values for a transaction you already approved. Nothing changes unless you accept.`}
        </p>

        <div className="overflow-hidden rounded-xl border" style={{ borderColor: 'var(--app-border)' }}>
          <table className="w-full table-fixed border-collapse text-sm">
            {/* The labels column fits its longest word, wrapping "Bank description", so the values have the
                room. A removal's bank column fits "No longer reported" on one line on a phone */}
            <colgroup>
              <col className="w-25" />
              <col />
              <col className={isRemoval ? 'w-37' : undefined} />
            </colgroup>
            <thead style={{ background: 'var(--app-surface-soft)' }}>
              <tr className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--app-text-muted)' }}>
                <th scope="col" className={`${CELL_CLASS_NAME} py-2 font-medium`}>
                  Field
                </th>
                <th scope="col" className={`${CELL_CLASS_NAME} py-2 font-medium`}>
                  In your ledger
                </th>
                <th scope="col" className={`${CELL_CLASS_NAME} py-2 font-medium`}>
                  {isRemoval ? 'Bank' : 'From bank'}
                </th>
              </tr>
            </thead>

            {/* A body per field, so the note under a value shares its tint and border */}
            {COMPARED_FIELDS.map(([field, label]) => {
              const isChanged = item.changed_fields.includes(field)
              const isEdited = item.protected_fields.some((edited) => edited === field)

              // A value the user kept apart from the bank's before. This change leaves it alone. A
              // removal shows no bank value to differ from
              const isKept =
                !isRemoval && !isChanged && formatValue(field, item.current) !== formatValue(field, item.bank)
              const rowPadding = `pt-2.5 ${isEdited || isKept ? 'pb-1' : 'pb-2.5'}`
              const valueClassName = `${CELL_CLASS_NAME} ${rowPadding} break-words ${field === 'amount' ? 'font-financial tabular-nums' : ''}`

              return (
                <tbody
                  key={field}
                  data-testid={`comparison-${field}`}
                  style={{
                    borderTop: '1px solid var(--app-border)',
                    background: isChanged ? 'var(--app-warning-soft)' : undefined,
                  }}
                >
                  <tr>
                    {/* Muted text falls short of AA contrast on the warning tint in the dark theme, so a
                        tinted row's label is in the full text colour */}
                    <th
                      scope="row"
                      className={`${CELL_CLASS_NAME} ${rowPadding} font-normal`}
                      style={{ color: isChanged ? 'var(--app-text)' : 'var(--app-text-muted)' }}
                    >
                      {label}
                    </th>
                    <td className={valueClassName} style={{ color: 'var(--app-text)' }}>
                      {formatValue(field, item.current)}
                    </td>
                    {isRemoval ? (
                      <td className={`${CELL_CLASS_NAME} py-2.5`} style={{ color: 'var(--app-text-muted)' }}>
                        No longer reported
                      </td>
                    ) : (
                      <td
                        className={valueClassName}
                        style={{ color: isChanged ? 'var(--app-warning-text)' : 'var(--app-text)' }}
                      >
                        {formatValue(field, item.bank)}
                      </td>
                    )}
                  </tr>

                  {/* Across the whole row, since squeezed into the bank's column it runs to several lines */}
                  {isEdited && (
                    <tr>
                      <td colSpan={3} className="px-4 pb-2.5 text-xs" style={{ color: 'var(--app-text)' }}>
                        <span className="flex items-start gap-1.5">
                          <Lock size={11} aria-hidden className="mt-0.5 shrink-0" />
                          You edited this. Accepting replaces your value with the bank&apos;s.
                        </span>
                      </td>
                    </tr>
                  )}
                  {isKept && (
                    <tr>
                      <td colSpan={3} className="px-4 pb-2.5 text-xs" style={{ color: 'var(--app-text-muted)' }}>
                        Your own value. Accepting leaves it as it is.
                      </td>
                    </tr>
                  )}
                </tbody>
              )
            })}
          </table>
        </div>

        <FormError message={error} />
      </div>
    </ModalTitledPanel>
  )
}
