import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link2 } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import RevealRow from '@/components/transactions/transaction-modal/sections/RevealRow'
import { useAccounts } from '@/api/accounts'
import { useCategories } from '@/api/categories'
import { useRefundLinkCandidates, type RefundLinkCandidate, type Transaction } from '@/api/transactions'
import { GlassSearchField } from '@/components/list-controls/GlassSearchField'
import LoadFailure from '@/components/errors/LoadFailure'
import { ModalFormFooter } from '@/components/modal/FormFooter'
import { MODAL_INSET_CLASS_NAME } from '@/components/modal/inset'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import { useTodayYmd } from '@/hooks/useTodayYmd'
import LinkCandidateRow from '@/components/transactions/transaction-modal/modals/LinkCandidateRow'
import LinkChainPreview from '@/components/transactions/transaction-modal/modals/LinkChainPreview'
import TransactionModalLinkRefundFilters from '@/components/transactions/transaction-modal/modals/LinkRefundFilters'
import UnlinkableCandidates from '@/components/transactions/transaction-modal/modals/UnlinkableCandidates'
import { NO_MERCHANT } from '@/components/transactions/transaction-modal/sections/RefundChain'
import { getRefusedRooms, groupLinkCandidates } from '@/components/transactions/transaction-modal/utils/refund'
import { toTransactionListAccount, type TransactionListFilters } from '@/components/transactions/types/transactionList'
import { normalizeTransactionFilters } from '@/components/transactions/utils/normalizeTransactionFilters'
import { formatShortDateRangeLabel } from '@/utils/date'

// How long typing pauses before the search is sent, so a word is one request rather than one per letter
const SEARCH_DEBOUNCE_MS = 250

// The dialog stands at Add transaction's height whatever it lists and whether its filters are open, and its body scrolls
const PANEL_CLASS_NAME = 'h-(--app-transaction-window-height) max-h-(--app-transaction-window-height)!'

// A little space between rows, so the borders of two picked rows next to each other stay two lines
const ROW_SPACING_CLASS_NAME = 'pb-1'

interface LinkRefundPickerProps {
  open: boolean
  onClose: () => void

  /** The open transaction. An expense picks the refund to link, and a refund picks its expense */
  transaction: Transaction

  /** Candidates already picked in the window, which are not offered again */
  heldIds: string[]

  /** Refunds whose link the window will remove on Save, which the list offers as if unlinked already */
  unlinkedIds: string[]

  /** What is left to refund of the open expense once its refunds, saved and held, are counted */
  refundRoom: number | undefined

  /** What is left to refund, sent with the list while the window holds links or refunds the server can't count */
  leftToRefund: number | undefined

  /** The round icon an expense and its refunds share */
  iconOf: (expense: Transaction) => ReactNode

  /** Holds the picks until the window is saved */
  onPick: (picked: Transaction[]) => void
}

/**
 * Opens over the transaction modal to link existing refunds to an expense, or an existing expense to
 * a refund. The server lists only what linking would accept, the likely matches first and then the
 * nearest, and the list's own filters narrow it. The list shows the likely matches and the others under their own
 * headings, and folds what can't be linked now into one row at the end that opens to say why for each. An expense
 * takes several refunds while their total stays within it, so each pick lowers what is left for the others and folds
 * away the rows it leaves no room for. Undoing the pick brings them back. A refund takes one expense, and pressing
 * another moves the pick. Above the buttons, a preview shows the chain linking would make. The modal's Link button,
 * live once one is picked, holds the picks until the window it opened from is saved
 */
export default function TransactionModalLinkRefundPicker({
  open,
  onClose,
  transaction,
  heldIds,
  unlinkedIds,
  refundRoom,
  leftToRefund,
  iconOf,
  onPick,
}: LinkRefundPickerProps) {
  const titleId = useId()
  const { formatCurrency, formatMovedCurrency } = useMoneyFormatters()
  const today = useTodayYmd()
  const [search, setSearch] = useState('')
  const [sentSearch, setSentSearch] = useState('')
  const [filters, setFilters] = useState<TransactionListFilters>({})
  const [pickedIds, setPickedIds] = useState<string[]>([])

  // The dialog's scrolling body, which holds the open filter panel inside it
  const bodyRef = useRef<HTMLElement | null>(null)

  // Opening or closing the filter panel un-pins or re-pins the block above the rows. The body goes back to the
  // top in the same frame. The pinned block sat at that top, so the search field and Filters button do not move
  const watchFilterPanel = (block: HTMLDivElement | null) => {
    if (!block) return
    const observer = new MutationObserver(() => {
      const body = block.closest<HTMLElement>('[data-tooltip-bounds]')
      bodyRef.current = body
      if (body) body.scrollTop = 0
    })
    observer.observe(block, { subtree: true, attributes: true, attributeFilter: ['aria-expanded'] })
    return () => observer.disconnect()
  }

  // The open filter panel is as wide as the search row, so it covers the row and the list under it edge to edge
  const [searchRowWidth, setSearchRowWidth] = useState<number>()
  const watchSearchRowWidth = (row: HTMLDivElement | null) => {
    if (!row) return
    bodyRef.current = row.closest<HTMLElement>('[data-tooltip-bounds]')
    const observer = new ResizeObserver(() => setSearchRowWidth(row.getBoundingClientRect().width))
    observer.observe(row)
    return () => observer.disconnect()
  }
  const picksRefund = transaction.amount < 0
  const candidates = useRefundLinkCandidates(open ? transaction.id : null, sentSearch, {
    ...filters,
    ...(unlinkedIds.length > 0 && { unlinked_id: unlinkedIds }),
    ...(leftToRefund !== undefined && { left_to_refund: leftToRefund }),
  })
  const { data: accounts } = useAccounts()
  const { data: categories } = useCategories()
  const transactionAccounts = useMemo(() => (accounts ?? []).map(toTransactionListAccount), [accounts])
  const accountById = useMemo(
    () => new Map(transactionAccounts.map((account) => [account.id, account])),
    [transactionAccounts],
  )
  const categoryById = useMemo(
    () => new Map((categories ?? []).map((category) => [category.id, category])),
    [categories],
  )

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setSentSearch(search.trim()), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timeoutId)
  }, [search])

  const handleClose = () => {
    setSearch('')
    setSentSearch('')
    setFilters({})
    setPickedIds([])
    onClose()
  }

  const rows = (candidates.data ?? []).filter((candidate) => !heldIds.includes(candidate.id))

  // A row a pick leaves no room for folds into the row of those that can't be linked, and comes back when the pick is
  // undone. The others keep the group the server's reasons give them
  const refusedRooms = getRefusedRooms(transaction, rows, refundRoom, pickedIds)
  const groups = groupLinkCandidates(rows, refusedRooms)
  const refusalFor = (room: number, candidate: Transaction): string => {
    if (picksRefund) {
      return room > 0
        ? `This refund is more than the ${formatCurrency(room, candidate.currency)} left to refund`
        : 'Nothing is left to refund on this expense'
    }
    return room > 0
      ? `This expense has only ${formatCurrency(room, candidate.currency)} left to refund`
      : 'This expense is already fully refunded'
  }

  // A pick that a search or filter has taken off the list is dropped, so it does not come back when they clear
  const picked = rows.filter((candidate) => pickedIds.includes(candidate.id))
  if (picked.length !== pickedIds.length && candidates.data !== undefined) setPickedIds(picked.map(({ id }) => id))

  // An expense takes several refunds, and a refund takes one expense, so pressing another row moves its pick
  const togglePick = (id: string) =>
    setPickedIds((current) =>
      current.includes(id) ? current.filter((pickedId) => pickedId !== id) : picksRefund ? [...current, id] : [id],
    )

  const setFilter = (patch: Partial<TransactionListFilters>) =>
    setFilters((current) => normalizeTransactionFilters({ ...current, ...patch }))

  const handleLink = () => {
    if (picked.length === 0) return
    onPick(picked)
    handleClose()
  }

  const resultKey = candidates.isError
    ? 'error'
    : candidates.isPending
      ? 'loading'
      : rows.length === 0
        ? 'empty'
        : 'rows'
  const hasNarrowing = sentSearch !== '' || Object.keys(filters).length > 0

  // The header names the open transaction, so the picker says what it links to
  const eyebrow = [
    transaction.merchant_name ?? NO_MERCHANT,
    formatShortDateRangeLabel(transaction.dt, transaction.dt, Number(today.slice(0, 4))),
    formatMovedCurrency(transaction.amount, transaction.currency),
  ].join(' · ')
  const kindOf = (expense: Transaction) => categoryById.get(expense.category_id)?.name ?? 'Uncategorized'

  const renderRow = (candidate: RefundLinkCandidate, refusal: string | null) => {
    const account = accountById.get(candidate.account_id)
    return (
      <RevealRow key={candidate.id} spacingClassName={ROW_SPACING_CLASS_NAME}>
        <LinkCandidateRow
          transaction={candidate}
          category={categoryById.get(candidate.category_id)}
          accountName={account?.name}
          accountInstitution={account?.institution}
          isPicked={pickedIds.includes(candidate.id)}
          refusal={refusal}
          onPick={() => {
            if (!refusal) togglePick(candidate.id)
          }}
        />
      </RevealRow>
    )
  }

  // A group with no rows left drops its heading with them
  const group = (key: string, heading: string, groupRows: RefundLinkCandidate[]) => (
    <AnimatePresence initial={false}>
      {groupRows.length > 0 && (
        <RevealRow key={key} spacingClassName="">
          <div role="group" aria-labelledby={`${titleId}-${key}`} data-testid={`link-group-${key}`}>
            <h3
              id={`${titleId}-${key}`}
              className="pb-2 pt-1 text-xs font-semibold uppercase tracking-wide"
              style={{ color: 'var(--app-text-subtle)' }}
            >
              {heading}
            </h3>
            <AnimatePresence initial={false}>
              {groupRows.map((candidate) => renderRow(candidate, null))}
            </AnimatePresence>
          </div>
        </RevealRow>
      )}
    </AnimatePresence>
  )
  return (
    <ModalTitledPanel
      open={open}
      level="stacked"
      onClose={handleClose}
      titleId={titleId}
      eyebrow={eyebrow}
      title={picksRefund ? 'Link a refund' : 'Link to an expense'}
      RailIcon={Link2}
      railLabel="Refund link"
      extraPanelClassName={PANEL_CLASS_NAME}
      footer={
        <>
          {/* Stays in view under the scrolling list, so each pick shows at once what linking would make */}
          <div
            className={`shrink-0 border-t py-3 ${MODAL_INSET_CLASS_NAME.stacked}`}
            style={{ borderColor: 'var(--app-border)' }}
          >
            <LinkChainPreview
              transaction={transaction}
              picked={picked}
              refundRoom={refundRoom}
              iconOf={iconOf}
              kindOf={kindOf}
            />
          </div>
          <ModalFormFooter
            level="stacked"
            submitLabel="Link"
            submitDisabled={false}
            submitBlockedReason={picked.length > 0 ? undefined : 'Pick a transaction first'}
            submitWidthClassName="w-full sm:w-auto"
            error={null}
            onCancel={handleClose}
            onPrimary={handleLink}
          />
        </>
      }
    >
      {/* Stays at the top of the scrolling body, so only the rows scroll beneath it. The body's padding is not
            part of what sticks, so the negative margin and offset reach it and the padding inside covers it. While the filter
            panel is open the block scrolls with the rows, so the panel adds to the scroll height */}
      <div
        ref={watchFilterPanel}
        className="sticky -top-4 z-10 -mt-4 space-y-4 pb-3 pt-4 has-[[aria-expanded=true]]:relative has-[[aria-expanded=true]]:top-0"
        style={{ background: 'var(--app-bg)' }}
      >
        <div ref={watchSearchRowWidth} className="flex items-start gap-3">
          <GlassSearchField
            value={search}
            onValueChange={setSearch}
            placeholder="Merchant or note…"
            inputId={`${titleId}-search`}
            wrapperClassName="flex-1"
          />
          <TransactionModalLinkRefundFilters
            filters={filters}
            setFilter={setFilter}
            accounts={transactionAccounts}
            categories={categories}
            panelWidth={searchRowWidth}
            constrainTo={bodyRef}
          />
        </div>
      </div>

      {/* The rows fade in where "Loading…" was, rather than the list snapping in */}
      <AnimatePresence initial={false}>
        <RevealRow key={resultKey}>
          {candidates.isError ? (
            <LoadFailure error={candidates.error} subject="Transactions to link" />
          ) : candidates.isPending ? (
            <p role="status" className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
              Loading…
            </p>
          ) : rows.length === 0 ? (
            <p role="status" className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
              {hasNarrowing
                ? `Nothing matches ${sentSearch === '' ? 'those filters' : Object.keys(filters).length === 0 ? 'that search' : 'that search or those filters'}.`
                : picksRefund
                  ? 'No money that comes in is free to link as a refund.'
                  : 'No expense is free to link this refund to.'}
            </p>
          ) : (
            <div data-testid="link-candidates">
              {group('likely', 'Likely matches', groups.likely)}
              {group('other', picksRefund ? 'Other money in' : 'Other expenses', groups.other)}
              <AnimatePresence initial={false}>
                {groups.unlinkable.length > 0 && (
                  <RevealRow key="unlinkable" spacingClassName="">
                    <UnlinkableCandidates picksRefund={picksRefund} rooms={groups.unlinkable.map(({ room }) => room)}>
                      <AnimatePresence initial={false}>
                        {groups.unlinkable.map(({ candidate, room }) =>
                          renderRow(candidate, refusalFor(room, candidate)),
                        )}
                      </AnimatePresence>
                    </UnlinkableCandidates>
                  </RevealRow>
                )}
              </AnimatePresence>
            </div>
          )}
        </RevealRow>
      </AnimatePresence>
    </ModalTitledPanel>
  )
}
