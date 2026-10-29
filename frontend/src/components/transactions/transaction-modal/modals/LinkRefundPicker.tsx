import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link2 } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import RevealRow from '@/components/transactions/transaction-modal/sections/RevealRow'
import { useAccounts } from '@/api/accounts'
import { useCategories } from '@/api/categories'
import { useRefundLinkCandidates, type Transaction } from '@/api/transactions'
import { GlassSearchField } from '@/components/list-controls/GlassSearchField'
import LoadFailure from '@/components/errors/LoadFailure'
import { ModalFormFooter } from '@/components/modal/FormFooter'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import TransactionRow from '@/components/transactions/Row'
import TransactionModalLinkRefundFilters from '@/components/transactions/transaction-modal/modals/LinkRefundFilters'
import { exceedsRefundRoom } from '@/components/transactions/transaction-modal/utils/refund'
import { toTransactionListAccount, type TransactionListFilters } from '@/components/transactions/types/transactionList'
import { normalizeTransactionFilters } from '@/components/transactions/utils/normalizeTransactionFilters'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'

// How long typing pauses before the search is sent, so a word is one request rather than one per letter
const SEARCH_DEBOUNCE_MS = 250

// From 750px the dialog fits its rows and stops at 60vh, which is 70% of the edit window's 86vh, scrolling beyond
// that. The filter panel opens downward over the list, so while it is open the dialog may grow to the stacked
// window's 84vh to make room for it, and eases back when it closes, on the app's default transition timing
const PANEL_CLASS_NAME =
  'min-[750px]:max-h-[60vh]! min-[750px]:has-[[aria-expanded=true]]:max-h-[84vh]! min-[750px]:transition-[max-height] motion-reduce:transition-none'
const BODY_CLASS_NAME =
  'min-[750px]:min-h-0 min-[750px]:has-[[aria-expanded=true]]:min-h-[34rem] min-[750px]:transition-[min-height] motion-reduce:transition-none'

// A picked row takes the accent fill and an accent border. The others keep a clear border so it eases in and out, and
// ease to a lower strength as a whole when one is picked, on the app's curve
const ROW_CLASS_NAME = 'scroll-mt-44 rounded-lg transition-[background-color,box-shadow] motion-reduce:transition-none'
const ROW_CONTENT_CLASS_NAME = 'transition-opacity motion-reduce:transition-none'
const RESTING_ROW_STYLE = { boxShadow: 'inset 0 0 0 1px transparent' }
const PICKED_ROW_STYLE = { boxShadow: 'inset 0 0 0 1px var(--app-accent)' }

// The picked row rests in the accent fill and deepens it under the pointer, as a chosen option in the filter panels
// does. The row inside draws no hover fill of its own over it
const PICKED_ROW_CLASS_NAME =
  'bg-[var(--app-accent-soft)] hover:bg-[var(--app-accent-chosen-hover-fill)] [&_.app-transaction-row]:bg-transparent!'

// How strongly a row that was not picked shows, as a share of full strength. Low enough that the picked row
// stands out at a glance
const RECEDED_ROW_OPACITY = 0.5

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

  /** Holds the pick until the window is saved */
  onPick: (picked: Transaction) => void
}

/**
 * Opens over the transaction modal to link an existing refund to an expense, or an existing expense to
 * a refund. The server lists only what linking would accept, the exact amount first and then the nearest,
 * and the list's own filters narrow it. A refund that would take the total refunded past the expense is
 * shown with the reason and can't be picked. Pressing a row picks it and fades the others, and the
 * modal's Link button, live once one is picked, holds the pick until the window it opened from is saved
 */
export default function TransactionModalLinkRefundPicker({
  open,
  onClose,
  transaction,
  heldIds,
  unlinkedIds,
  refundRoom,
  onPick,
}: LinkRefundPickerProps) {
  const titleId = useId()
  const { formatCurrency } = useMoneyFormatters()
  const [search, setSearch] = useState('')
  const [sentSearch, setSentSearch] = useState('')
  const [filters, setFilters] = useState<TransactionListFilters>({})
  const [pickedId, setPickedId] = useState<string | null>(null)

  // The dialog's scrolling body, which holds the open filter panel inside it
  const bodyRef = useRef<HTMLElement | null>(null)

  // Opening or closing the filter panel un-pins or re-pins the block above the rows. The body goes back to the
  // top in the same frame, which is where the pinned block was, so the explanation, search field and Filters
  // button do not move
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
  const candidates = useRefundLinkCandidates(
    open ? transaction.id : null,
    sentSearch,
    unlinkedIds.length > 0 ? { ...filters, unlinked_id: unlinkedIds } : filters,
  )
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
    setPickedId(null)
    onClose()
  }

  const rows = (candidates.data ?? []).filter((candidate) => !heldIds.includes(candidate.id))

  // Why a candidate can't be picked: linking it would take the refunds past the expense. An expense is
  // offered refunds against the room it has left, and a refund is offered expenses by their own room
  const refusalFor = (candidate: Transaction): string | null => {
    const [room, currency] = picksRefund
      ? [refundRoom, transaction.currency]
      : [-candidate.amount - (candidate.refunded_amount ?? 0), candidate.currency]
    if (room === undefined) return null
    const refund = picksRefund ? candidate : transaction
    if (!exceedsRefundRoom(refund, currency, room)) return null
    return room > 0 ? `Only ${formatCurrency(room, currency)} is left to refund` : 'Already fully refunded'
  }

  // A pick that a search or filter has taken off the list is dropped, so it does not come back when they clear
  const picked = rows.find((candidate) => candidate.id === pickedId && !refusalFor(candidate)) ?? null
  if (pickedId !== null && picked === null && candidates.data !== undefined) setPickedId(null)

  const setFilter = (patch: Partial<TransactionListFilters>) =>
    setFilters((current) => normalizeTransactionFilters({ ...current, ...patch }))

  const handleLink = () => {
    if (!picked) return
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
      extraPanelClassName={PANEL_CLASS_NAME}
      footer={
        <ModalFormFooter
          level="stacked"
          submitLabel="Link"
          submitDisabled={false}
          submitBlockedReason={picked ? undefined : 'Pick a transaction first'}
          submitWidthClassName="w-full sm:w-auto"
          error={null}
          onCancel={handleClose}
          onPrimary={handleLink}
        />
      }
    >
      {/* From 750px the filter panel opens downward over the list, so the body grows to hold it while it is open */}
      <div className={BODY_CLASS_NAME} data-testid="link-picker-body">
        {/* Stays at the top of the scrolling body, so only the rows scroll beneath it. The body's padding is not
            part of what sticks, so the negative margin and offset reach it and the padding inside covers it. While the filter
            panel is open the block scrolls with the rows, so the panel adds to the scroll height */}
        <div
          ref={watchFilterPanel}
          className="sticky -top-4 z-10 -mt-4 space-y-4 pb-3 pt-4 has-[[aria-expanded=true]]:relative has-[[aria-expanded=true]]:top-0"
          style={{ background: 'var(--app-bg)' }}
        >
          <p className="text-sm leading-6" style={{ color: 'var(--app-text-muted)' }}>
            {picksRefund
              ? 'Pick money that came in to link as a refund of this expense. Linking changes no amount or total.'
              : 'Pick the expense this refund gives money back for. Linking changes no amount or total.'}
          </p>
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

        {/* When the rows arrive in place of "Loading…" the window grows to fit them and they fade in, rather than
            the list snapping in */}
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
                    ? 'No money that came in is free to link as a refund.'
                    : 'No expense is free to link this refund to.'}
              </p>
            ) : (
              <div role="group" aria-label="Transactions that can be linked" data-testid="link-candidates">
                {rows.map((candidate) => {
                  const account = accountById.get(candidate.account_id)
                  const isPicked = candidate.id === picked?.id
                  const refusal = refusalFor(candidate)

                  // Rows recede only while one is picked. A refused row stays at full strength with its reason
                  const receded = picked !== null && !isPicked
                  const contentStyle: CSSProperties = { opacity: receded ? RECEDED_ROW_OPACITY : 1 }
                  return (
                    <div
                      key={candidate.id}
                      className={isPicked ? `${ROW_CLASS_NAME} ${PICKED_ROW_CLASS_NAME}` : ROW_CLASS_NAME}
                      style={isPicked ? PICKED_ROW_STYLE : RESTING_ROW_STYLE}
                      data-testid="link-candidate"
                      data-picked={isPicked ? 'true' : undefined}
                      data-refused={refusal ? 'true' : undefined}
                    >
                      <div className={ROW_CONTENT_CLASS_NAME} style={contentStyle}>
                        <TransactionRow
                          transaction={candidate}
                          currency={candidate.currency}
                          category={categoryById.get(candidate.category_id)}
                          accountName={account?.name}
                          accountInstitution={account?.institution}
                          skipEnterAnimation
                          phoneLayout
                          note={refusal ?? undefined}
                          pressed={isPicked}
                          onOpen={() => setPickedId(isPicked ? null : candidate.id)}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </RevealRow>
        </AnimatePresence>
      </div>
    </ModalTitledPanel>
  )
}
