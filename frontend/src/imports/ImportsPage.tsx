import { useNavigate } from 'react-router-dom'
import { Upload, X } from 'lucide-react'
import { useTransactionImportWorkflow } from './hooks'
import {
  ImportAccountMappingStep,
  ImportAutoCreateStep,
  ImportCategoryMatchingStep,
  ImportColumnMappingStep,
  ImportCommitPanel,
  ImportFilesStep,
  ImportPreviewStep,
} from './sections'

export default function ImportsPage() {
  const navigate = useNavigate()
  const workflow = useTransactionImportWorkflow()

  return (
    <div
      className="relative flex h-screen min-h-screen overflow-hidden"
      style={{ background: 'var(--app-bg)', color: 'var(--app-text)' }}
    >
      <button
        type="button"
        className="app-icon-button absolute right-5 top-5 z-20 shrink-0 sm:right-8 sm:top-6"
        onClick={() => navigate('/settings')}
        aria-label="Close import workflow"
      >
        <X size={20} aria-hidden />
      </button>

      <div
        className="hidden w-16 shrink-0 flex-col items-center justify-between py-7 sm:flex"
        style={{
          background: 'var(--app-button-primary-bg)',
          color: 'var(--app-button-primary-text)',
        }}
        aria-hidden
      >
        <Upload size={19} strokeWidth={2} />
        <span className="rotate-180 text-xs font-semibold uppercase" style={{ writingMode: 'vertical-rl' }}>
          Import
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="shrink-0 px-5 pb-5 pt-6 sm:px-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0 pr-14 sm:pr-16">
              <p className="mb-2 text-xs font-semibold uppercase" style={{ color: 'var(--app-accent)' }}>
                CSV import
              </p>
              <h1 className="font-serif text-3xl font-light">
                Import Transactions
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6" style={{ color: 'var(--app-text-muted)' }}>
                Stage one CSV transaction file before it is added to your ledger.
              </p>
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-3 sm:px-8 xl:overflow-hidden">
          <div className="flex min-h-full flex-col gap-8 xl:h-full xl:min-h-0 xl:flex-row">
            <aside className="xl:h-full xl:w-[340px] xl:shrink-0">
              <ImportFilesStep {...workflow} />
            </aside>

            <div className="min-w-0 xl:h-full xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:pr-1">
              <div className="space-y-8">
                <ImportColumnMappingStep {...workflow} />
                <ImportAccountMappingStep {...workflow} />
                <ImportCategoryMatchingStep {...workflow} />
                <ImportAutoCreateStep
                  index="05"
                  title="Merchant Handling"
                  description="Merchants are created when transactions are imported. If an imported merchant matches an existing merchant name, the transaction will use the existing merchant."
                  expanded={workflow.merchantHandlingOpen}
                  collapseLabel="Collapse merchant handling"
                  expandLabel="Expand merchant handling"
                  emptyTitle="No imported merchants detected"
                  emptyDescription="Map a merchant column first."
                  sourceLabel="Merchant From File"
                  rows={workflow.importedMerchants}
                  onToggle={() => workflow.setMerchantHandlingOpen((current) => !current)}
                />
                <ImportAutoCreateStep
                  index="06"
                  title="Tag Handling"
                  description="Tags are created when transactions are imported. If an imported tag matches an existing tag name, the transaction will use the existing tag."
                  expanded={workflow.tagHandlingOpen}
                  collapseLabel="Collapse tag handling"
                  expandLabel="Expand tag handling"
                  emptyTitle="No imported tags detected"
                  emptyDescription="Map a tags column first."
                  sourceLabel="Tag From File"
                  rows={workflow.importedTags}
                  onToggle={() => workflow.setTagHandlingOpen((current) => !current)}
                />
                <ImportPreviewStep {...workflow} />
                <ImportCommitPanel {...workflow} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
