import { useId, useMemo, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import { useAccounts } from '@/api/accounts'
import { useCategories } from '@/api/categories'
import { useMerchantDetails } from '@/api/merchants'
import { useTagDetails } from '@/api/tags'
import { useExportTransactions } from '@/api/transactions'
import { GlassSearchField } from '@/components/list-controls/GlassSearchField'
import { ModalFormFooter } from '@/components/modal/FormFooter'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import { describeExport } from '@/components/transactions/export/describeExport'
import { ExportSummary } from '@/components/transactions/export/ExportSummary'
import TransactionModalLinkRefundFilters from '@/components/transactions/transaction-modal/modals/LinkRefundFilters'
import { toTransactionListAccount, type TransactionListFilters } from '@/components/transactions/types/transactionList'
import { getExportFailureMessage, getExportFilename, hasExportRows } from '@/components/transactions/utils/exportFile'
import { normalizeTransactionFilters } from '@/components/transactions/utils/normalizeTransactionFilters'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import { formatOpenDateRangeLabel } from '@/utils/date'
import { saveBlobAsFile } from '@/utils/downloadFile'
import { LOADING_ANIMATION_MIN_MS } from '@/utils/timing'

// The dialogue stands at the height the refund picker does while the person chooses, so the filter panel
// opening inside it has room, and shrinks to its text for the confirmation
const CHOOSE_PANEL_CLASS_NAME = 'h-(--app-transaction-window-height) max-h-(--app-transaction-window-height)!'

const NOTHING_MATCHES_MESSAGE = 'Nothing was downloaded: no transactions match these choices. Go back to change them.'

type ExportDialogProps = {
  open: boolean
  onClose: () => void

  /** The list's filters, date range included only when the page has one, which the dialogue starts from and then edits on its own */
  initialFilters: TransactionListFilters

  /** The list's submitted search, which the dialogue starts from and then edits on its own */
  initialSearch: string

  /** The day as "YYYY-MM-DD", which names the file */
  today: string
}

/**
 * Chooses what to export and then confirms it before anything downloads
 *
 * The choices are the Transactions filters and search, copied in when the dialogue opens and edited
 * here, so nothing done here changes the list behind it. Download moves to a confirmation saying in
 * words what the file will hold, and only its button starts the download. Conditions that match
 * nothing are refused there with a message rather than saving a file of one header row
 */
export function ExportDialog({ open, onClose, initialFilters, initialSearch, today }: ExportDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const [step, setStep] = useState<'choose' | 'confirm'>('choose')
  const [filters, setFilters] = useState(initialFilters)
  const [search, setSearch] = useState(initialSearch)
  const [problem, setProblem] = useState<string | null>(null)
  const exportTransactions = useExportTransactions({ minimumPendingMs: LOADING_ANIMATION_MIN_MS })
  const { formatCurrency } = useMoneyFormatters()

  const { data: accounts } = useAccounts()
  const { data: categories } = useCategories()
  const transactionAccounts = useMemo(() => (accounts ?? []).map(toTransactionListAccount), [accounts])
  const merchantQueries = useMerchantDetails(filters.merchant_id ?? [])
  const tagQueries = useTagDetails(filters.tag_id ?? [])

  // The dialogue's scrolling body, which the open filter panel has to stay inside, and the width of the
  // search row, which the open panel covers edge to edge
  const bodyRef = useRef<HTMLElement | null>(null)
  const [searchRowWidth, setSearchRowWidth] = useState<number>()
  const watchSearchRow = (row: HTMLDivElement | null) => {
    if (!row) return
    bodyRef.current = row.closest<HTMLElement>('[data-tooltip-bounds]')
    const observer = new ResizeObserver(() => setSearchRowWidth(row.getBoundingClientRect().width))
    observer.observe(row)
    return () => observer.disconnect()
  }

  const setFilter = (patch: Partial<TransactionListFilters>) =>
    setFilters((current) => normalizeTransactionFilters({ ...current, ...patch }))

  const description = describeExport({
    filters,
    search,
    formatAmount: formatCurrency,
    names: {
      accounts: new Map(transactionAccounts.map((account) => [account.id, account.name ?? 'Unnamed account'])),
      categories: new Map((categories ?? []).map((category) => [category.id, category.name])),
      merchants: new Map(
        (filters.merchant_id ?? []).flatMap((id, index) => {
          const name = merchantQueries[index]?.data?.name
          return name === undefined ? [] : [[id, name] as const]
        }),
      ),
      tags: new Map(
        (filters.tag_id ?? []).flatMap((id, index) => {
          const name = tagQueries[index]?.data?.name
          return name === undefined ? [] : [[id, name] as const]
        }),
      ),
    },
  })

  const isPending = exportTransactions.isPending
  const error = problem ?? (exportTransactions.isError ? getExportFailureMessage(exportTransactions.error) : null)

  function goBack() {
    setProblem(null)
    exportTransactions.reset()
    setStep('choose')
  }

  async function download() {
    setProblem(null)
    try {
      const file = await exportTransactions.mutateAsync({ ...filters, q: search.trim() || undefined })
      if (!(await hasExportRows(file))) {
        setProblem(NOTHING_MATCHES_MESSAGE)
        return
      }
      saveBlobAsFile(file, getExportFilename(today))
      onClose()
    } catch {
      // The mutation holds the failure, which the footer shows
    }
  }

  const isChoosing = step === 'choose'
  return (
    <ModalTitledPanel
      open={open}
      onClose={onClose}
      titleId={titleId}
      descriptionId={descriptionId}
      eyebrow="Export"
      title={isChoosing ? 'Export transactions' : 'Download this file?'}
      RailIcon={Download}
      railLabel="Export"
      extraPanelClassName={isChoosing ? CHOOSE_PANEL_CLASS_NAME : ''}
      closeDisabled={isPending}
      footer={
        isChoosing ? (
          <ModalFormFooter
            submitLabel="Download"
            submitDisabled={false}
            submitWidthClassName="w-full sm:w-auto"
            onCancel={onClose}
            onPrimary={() => setStep('confirm')}
          />
        ) : (
          <ModalFormFooter
            submitLabel="Download CSV"
            submitDisabled={isPending}
            submitBlockedReason={description ? undefined : 'Still loading the names of your choices'}
            submitWidthClassName="w-full sm:w-auto"
            error={error}
            onCancel={onClose}
            onBack={goBack}
            onPrimary={download}
          />
        )
      }
    >
      {isChoosing ? (
        <div id={descriptionId} className="space-y-4">
          <p className="text-sm leading-6" style={{ color: 'var(--app-text-muted)' }}>
            Choose what goes in the CSV file. It starts from what the page shows, and changing it here leaves the list
            as it is.
          </p>
          <div ref={watchSearchRow} className="flex items-start gap-3">
            <GlassSearchField
              value={search}
              onValueChange={setSearch}
              placeholder="Search transactions..."
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
          <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
            {filters.from_date || filters.to_date
              ? `You'll get transactions dated ${formatOpenDateRangeLabel(filters.from_date ?? '', filters.to_date ?? '')}.`
              : "You'll get transactions from every date."}
          </p>
        </div>
      ) : (
        <div id={descriptionId}>
          {description ? (
            <ExportSummary description={description} />
          ) : (
            <p role="status" className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
              Loading…
            </p>
          )}
        </div>
      )}
    </ModalTitledPanel>
  )
}
