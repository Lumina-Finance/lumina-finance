import { useEffect, useId, useState } from 'react'
import { Link2 } from 'lucide-react'
import { ApiError } from '@/api/auth'
import { useLinkRefund, useRefundLinkCandidates, type Transaction } from '@/api/transactions'
import { GlassSearchField } from '@/components/list-controls/GlassSearchField'
import LoadFailure from '@/components/errors/LoadFailure'
import { MODAL_INSET_CLASS_NAME } from '@/components/modal/inset'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import { formatDateLabel } from '@/utils/date'

// How long typing pauses before the search is sent, so a word is one request rather than one per letter
const SEARCH_DEBOUNCE_MS = 250

interface LinkRefundPickerProps {
  open: boolean
  onClose: () => void

  /** The open transaction. An expense picks the refund to link, and a refund picks its expense */
  transaction: Transaction
}

/**
 * Opens over the transaction modal to link an existing refund to an expense, or an existing expense to
 * a refund. The server lists only what linking would accept, so every row offered can be linked
 */
export default function TransactionModalLinkRefundPicker({
  open,
  onClose,
  onLinked,
  transaction,
}: LinkRefundPickerProps) {
  const titleId = useId()
  const { formatMovedCurrency } = useMoneyFormatters()
  const [search, setSearch] = useState('')
  const [sentSearch, setSentSearch] = useState('')
  const link = useLinkRefund()
  const picksRefund = transaction.amount < 0
  const candidates = useRefundLinkCandidates(open ? transaction.id : null, sentSearch)

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setSentSearch(search.trim()), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timeoutId)
  }, [search])

  const handleClose = () => {
    link.reset()
    setSearch('')
    setSentSearch('')
    onClose()
  }

  const handleLink = (candidate: Transaction) => {
    const [refundId, originalId] = picksRefund ? [candidate.id, transaction.id] : [transaction.id, candidate.id]
    link.mutate(
      { refundId, originalId },
      {
        onSuccess: () => {
          handleClose()
          onLinked?.()
        },
      },
    )
  }

  const rows = candidates.data ?? []
  return (
    <ModalTitledPanel
      open={open}
      level="stacked"
      onClose={handleClose}
      titleId={titleId}
      eyebrow="Refund link"
      title={picksRefund ? 'Link a refund' : 'Link to an expense'}
      RailIcon={Link2}
      railLabel="Refund link"
      closeDisabled={link.isPending}
      footer={(
        <div
          className={`flex shrink-0 justify-end py-4 min-[1050px]:py-5 ${MODAL_INSET_CLASS_NAME.stacked}`}
          style={{ borderTop: '1px solid var(--app-border)' }}
        >
          <button type="button" className="app-secondary-button w-full sm:w-auto" onClick={handleClose} disabled={link.isPending}>
            Cancel
          </button>
        </div>
      )}
    >
      <div className="space-y-4">
        <p className="text-sm leading-6" style={{ color: 'var(--app-text-muted)' }}>
          {picksRefund
            ? 'Pick money that came in to link as a refund of this expense. Linking changes no amount or total.'
            : 'Pick the expense this refund gives money back for. Linking changes no amount or total.'}
        </p>
        <GlassSearchField
          value={search}
          onValueChange={setSearch}
          placeholder="Search by merchant or note…"
          inputId={`${titleId}-search`}
        />

        {candidates.isError ? (
          <LoadFailure error={candidates.error} subject="Transactions to link" />
        ) : candidates.isPending ? (
          <p role="status" className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
            Loading…
          </p>
        ) : rows.length === 0 ? (
          <p role="status" className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
            {sentSearch
              ? 'Nothing matches that search.'
              : picksRefund
                ? 'No money that came in is free to link as a refund.'
                : 'No expense is free to link this refund to.'}
          </p>
        ) : (
          <ul className="space-y-2" aria-label="Transactions that can be linked">
            {rows.map((candidate) => {
              const merchantName = candidate.merchant_name ?? 'No merchant'
              return (
                <li
                  key={candidate.id}
                  className="flex items-center justify-between gap-3 rounded-lg px-3 py-2"
                  style={{ background: 'var(--app-surface-soft)', border: '1px solid var(--app-border)' }}
                  data-testid="link-candidate"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium leading-5" style={{ color: 'var(--app-text)' }}>
                      {merchantName}
                    </p>
                    <p className="truncate text-xs leading-4" style={{ color: 'var(--app-text-muted)' }}>
                      {formatDateLabel(candidate.dt)}
                      {candidate.notes ? ` · ${candidate.notes}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="font-financial text-sm" style={{ color: 'var(--app-text)' }}>
                      {formatMovedCurrency(candidate.amount, candidate.currency)}
                    </span>
                    <button
                      type="button"
                      className="app-secondary-button"
                      aria-label={`Link ${merchantName} on ${formatDateLabel(candidate.dt)}`}
                      disabled={link.isPending}
                      onClick={() => handleLink(candidate)}
                    >
                      Link
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {link.isError && (
          <p role="alert" className="text-sm" style={{ color: 'var(--app-negative)' }}>
            {link.error instanceof ApiError ? link.error.message : 'Oops, something went wrong. Please try again.'}
          </p>
        )}
      </div>
    </ModalTitledPanel>
  )
}
