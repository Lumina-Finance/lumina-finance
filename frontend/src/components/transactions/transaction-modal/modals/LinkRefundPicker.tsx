import { useEffect, useId, useMemo, useState, type CSSProperties } from 'react'
import { Link2 } from 'lucide-react'
import { ApiError } from '@/api/auth'
import { useAccounts } from '@/api/accounts'
import { useCategories } from '@/api/categories'
import { useLinkRefund, useRefundLinkCandidates, type Transaction } from '@/api/transactions'
import { GlassSearchField } from '@/components/list-controls/GlassSearchField'
import LoadFailure from '@/components/errors/LoadFailure'
import { ModalFormFooter } from '@/components/modal/FormFooter'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import TransactionRow from '@/components/transactions/Row'
import TransactionModalLinkRefundFilters from '@/components/transactions/transaction-modal/modals/LinkRefundFilters'
import { toTransactionListAccount, type TransactionListFilters } from '@/components/transactions/types/transactionList'
import { normalizeTransactionFilters } from '@/components/transactions/utils/normalizeTransactionFilters'
import { FADED_ROW_COLOURS, FadedRowsContext } from '@/contexts/FadedRowsContext'

// How long typing pauses before the search is sent, so a word is one request rather than one per letter
const SEARCH_DEBOUNCE_MS = 250

// From 1050px, where the shell stops filling the screen, the panel grows with its rows up to about 70% of the create
// transaction window's 86vh. Below that it keeps the full height the shell gives it
const PANEL_HEIGHT_CLASS_NAME = 'min-[1050px]:max-h-[60vh]'

// A picked row takes the accent fill and an accent border. The others keep a clear border so it eases in and out, and
// every part inside a row eases with it, on the app's curve
const ROW_CLASS_NAME =
  'scroll-mt-44 rounded-lg transition-[background-color,box-shadow,color] motion-reduce:transition-none [&_*]:transition-[color,background-color,opacity] motion-reduce:[&_*]:transition-none'
const RESTING_ROW_STYLE = { boxShadow: 'inset 0 0 0 1px transparent' }
const PICKED_ROW_STYLE = { background: 'var(--app-accent-soft)', boxShadow: 'inset 0 0 0 1px var(--app-accent)' }

// Opening or closing the filter panel un-pins or re-pins the block above the rows. The body goes back to the top in the
// same frame, which is where the pinned block was, so the explanation, search field and Filters button do not move
function watchFilterPanel(block: HTMLDivElement | null) {
  if (!block) return
  const observer = new MutationObserver(() => {
    const body = block.closest('[data-tooltip-bounds]')
    if (body) body.scrollTop = 0
  })
  observer.observe(block, { subtree: true, attributes: true, attributeFilter: ['aria-expanded'] })
  return () => observer.disconnect()
}

// How far the icon of a row that was not picked is dimmed. An icon has no text, so contrast doesn't bound it
const GREYED_ICON_OPACITY = 0.3
const GREYED_ROW_STYLE = {
  ...FADED_ROW_COLOURS,
  ...RESTING_ROW_STYLE,
  '--app-faded-icon-opacity': GREYED_ICON_OPACITY,
} as CSSProperties

interface LinkRefundPickerProps {
  open: boolean
  onClose: () => void

  /** The open transaction. An expense picks the refund to link, and a refund picks its expense */
  transaction: Transaction
}

/**
 * Opens over the transaction modal to link an existing refund to an expense, or an existing expense to
 * a refund. The server lists only what linking would accept, the exact amount first and then the nearest,
 * and the list's own filters narrow it. Pressing a row picks it and greys the others out, and the
 * modal's Link button, live once one is picked, links it
 */
export default function TransactionModalLinkRefundPicker({ open, onClose, transaction }: LinkRefundPickerProps) {
  const titleId = useId()
  const [search, setSearch] = useState('')
  const [sentSearch, setSentSearch] = useState('')
  const [filters, setFilters] = useState<TransactionListFilters>({})
  const [pickedId, setPickedId] = useState<string | null>(null)

  // The open filter panel is as wide as the search row, so it covers the row and the list under it edge to edge
  const [searchRowWidth, setSearchRowWidth] = useState<number>()
  const watchSearchRowWidth = (row: HTMLDivElement | null) => {
    if (!row) return
    const observer = new ResizeObserver(() => setSearchRowWidth(row.getBoundingClientRect().width))
    observer.observe(row)
    return () => observer.disconnect()
  }
  const link = useLinkRefund()
  const picksRefund = transaction.amount < 0
  const candidates = useRefundLinkCandidates(open ? transaction.id : null, sentSearch, filters)
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
    link.reset()
    setSearch('')
    setSentSearch('')
    setFilters({})
    setPickedId(null)
    onClose()
  }

  const rows = candidates.data ?? []

  // A pick that a search or filter has taken off the list is dropped, so it does not come back when they clear
  const picked = rows.find((candidate) => candidate.id === pickedId) ?? null
  if (pickedId !== null && picked === null && candidates.data !== undefined) setPickedId(null)

  const setFilter = (patch: Partial<TransactionListFilters>) =>
    setFilters((current) => normalizeTransactionFilters({ ...current, ...patch }))

  const handleLink = () => {
    if (!picked) return
    const [refundId, originalId] = picksRefund ? [picked.id, transaction.id] : [transaction.id, picked.id]
    link.mutate(
      { refundId, originalId },
      { onSuccess: handleClose },
    )
  }

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
      closeDisabled={link.isPending}
      extraPanelClassName={PANEL_HEIGHT_CLASS_NAME}
      footer={
        <ModalFormFooter
          level="stacked"
          submitLabel="Link"
          submitDisabled={link.isPending}
          submitBlockedReason={picked ? undefined : 'Pick a transaction first'}
          submitWidthClassName="w-full sm:w-auto"
          error={
            link.isError
              ? link.error instanceof ApiError
                ? link.error.message
                : 'Oops, something went wrong. Please try again.'
              : null
          }
          onCancel={handleClose}
          onPrimary={handleLink}
        />
      }
    >
      {/* From 750px the filter panel opens downward over the list, so the body keeps room for most of it */}
      <div className="min-[750px]:min-h-[26rem]">
        {/* Stays at the top of the scrolling body, so only the rows scroll beneath it. The body's padding is not
            part of what sticks, so the negative margin and offset reach it and the padding inside covers it. While the filter
            panel is open the block scrolls with the rows, so the panel adds to the scroll height and its last button can scroll above the footer */}
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
            />
          </div>
        </div>

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

              // Once one is picked the rest are greyed out the way the Upcoming section greys its rows, with their
              // icons dimmed much further, since their text can't go below the muted token and stay readable
              const isGreyed = picked !== null && !isPicked
              return (
                <div
                  key={candidate.id}
                  className={ROW_CLASS_NAME}
                  style={isPicked ? PICKED_ROW_STYLE : isGreyed ? GREYED_ROW_STYLE : RESTING_ROW_STYLE}
                  data-testid="link-candidate"
                  data-picked={isPicked ? 'true' : undefined}
                >
                  <FadedRowsContext.Provider value={isGreyed}>
                    <TransactionRow
                      transaction={candidate}
                      currency={candidate.currency}
                      category={categoryById.get(candidate.category_id)}
                      accountName={account?.name}
                      accountInstitution={account?.institution}
                      skipEnterAnimation
                      phoneLayout
                      pressed={isPicked}
                      onOpen={() => setPickedId(isPicked ? null : candidate.id)}
                    />
                  </FadedRowsContext.Provider>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </ModalTitledPanel>
  )
}
