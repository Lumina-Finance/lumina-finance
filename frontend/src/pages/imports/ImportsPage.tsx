import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Upload, X } from 'lucide-react'
import { accountKeys, categoryKeys, institutionKeys, merchantKeys } from '@/api/cache/queryKeys'
import {
  ACCOUNTS_LOAD_FAILURE_EXPLANATION,
  ACCOUNTS_LOAD_FAILURE_TITLE,
  IMPORT_NOT_PERMITTED_EXPLANATION,
  IMPORT_NOT_PERMITTED_TITLE,
} from './constants'
import { ImportLoadFailure, ImportProgressOverlay } from './components'
import { useFireflyImportWorkflow } from './firefly/hooks'
import {
  FireflyAccountMappingStep,
  FireflyExpectationsCard,
  FireflyBudgetImportStep,
  FireflyCategoryMatchingStep,
  FireflyFilesStep,
  FireflyPreviewStep,
} from './firefly/sections'
import { useImportAccountScope, useTransactionImportWorkflow } from './hooks'
import {
  ImportAccountMappingStep,
  ImportAutoCreateStep,
  ImportMerchantMatchingStep,
  ImportCategoryMatchingStep,
  ImportColumnMappingStep,
  ImportCommitPanel,
  ImportFilesStep,
  ImportPreviewStep,
  ImportSourceStep,
} from './sections'
import type { ImportDataSource } from './types'

/**
 * Renders the CSV import workflow page, switching between the generic and Firefly III flows and
 * showing the shared progress overlay while a commit runs
 *
 * Only one flow can be staged at a time, so changing the data source resets whichever flow is being
 * left, so its staged state cannot leak into a later import run
 */
export default function ImportsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [dataSource, setDataSource] = useState<ImportDataSource>('generic')
  const accountScope = useImportAccountScope()
  const workflow = useTransactionImportWorkflow()
  const fireflyWorkflow = useFireflyImportWorkflow()

  // An import started from an account is the generic flow and nothing else, since the account it
  // fixes has no meaning to the Firefly one. Read from the scope rather than from the stored choice,
  // because that choice is page state and a change of query string leaves the page mounted, so a
  // scope arriving over a staged Firefly export has to render the generic flow without disturbing
  // what the user had. Leaving the scope gives that export back
  const isScopedToAccount = accountScope.state === 'ready'
  const isFirefly = !isScopedToAccount && dataSource === 'firefly'
  const importOverlayOpen = isFirefly ? fireflyWorkflow.importOverlayOpen : workflow.importOverlayOpen

  // Where the page came from, which is also where its two exits go while the scope holds
  const scopedAccountPath = accountScope.accountId ? `/accounts/${accountScope.accountId}` : null

  // The overlay covers the page for as long as it takes to fade, which is after the import it was
  // showing has already ended, so the page under it is held until it has actually gone rather than
  // until the import finished
  const [overlayOnScreen, setOverlayOnScreen] = useState(false)
  if (importOverlayOpen && !overlayOnScreen) setOverlayOnScreen(true)

  // Switching source resets the flow being left, so a file still being read or an import still
  // being written would finish into a flow the user has already discarded
  const isImportBusy = overlayOnScreen || (isFirefly
    ? fireflyWorkflow.processingFileKind !== null || fireflyWorkflow.isImportingBudgets
    : workflow.isProcessingFiles || workflow.isImportInFlight)

  // Every mapping answer is made against these three lists, and one of them going stale sends the
  // import at a category or account that has since been renamed or deleted elsewhere. Categories in
  // particular never revalidate on their own, since their query never goes stale and the cache is
  // kept in local storage for months. Invalidating here rather than inside the reference-data hook,
  // which both workflows mount: two refetches issued in the same commit cancel one another
  // Exact, since the account list's key is the prefix of every per-account key: without it, opening
  // this page marks each account's snapshots, cash flow and spending breakdown stale as well, and
  // the account pages refetch all of them instead of painting from the cache
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: accountKeys.list(), exact: true })
    void queryClient.invalidateQueries({ queryKey: categoryKeys.list(), exact: true })
    void queryClient.invalidateQueries({ queryKey: institutionKeys.list(), exact: true })

    // Asked again rather than read back, since a merchant created in another tab would otherwise
    // leave a payee value reading as one with no merchant yet
    void queryClient.invalidateQueries({ queryKey: merchantKeys.nameMatchesAll })
  }, [queryClient])

  const handleDataSourceChange = (next: ImportDataSource) => {
    if (next === dataSource || isImportBusy) return

    // The flow being switched away from resets so its staged state cannot
    // leak into a later import run
    if (dataSource === 'generic') {
      workflow.resetImportWorkflow()
    } else {
      fireflyWorkflow.resetFireflyWorkflow()
    }
    setDataSource(next)
  }

  const handleDone = () => {
    navigate(isScopedToAccount && scopedAccountPath ? scopedAccountPath : '/')
  }

  // The scope is settled against the accounts list, so the page holds until that answer arrives and
  // shows no import flow at all where the answer is no. Settings is the way out of all three, since
  // none of them has an account worth returning to
  if (accountScope.state !== 'unscoped' && accountScope.state !== 'ready') {
    return (
      <div
        className="relative flex h-screen min-h-screen flex-col items-center justify-center px-5"
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

        {accountScope.state === 'loading' && <div className="app-spinner" role="status" aria-label="Loading" />}

        {accountScope.state === 'failed' && (
          <div className="w-full max-w-md">
            <ImportLoadFailure
              title={ACCOUNTS_LOAD_FAILURE_TITLE}
              description={ACCOUNTS_LOAD_FAILURE_EXPLANATION}
              onRetry={accountScope.refetchAccounts}
            />
          </div>
        )}

        {accountScope.state === 'unavailable' && (
          <div className="max-w-md text-center">
            <h1 className="app-page-title">{IMPORT_NOT_PERMITTED_TITLE}</h1>
            <p className="app-page-description">{IMPORT_NOT_PERMITTED_EXPLANATION}</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className="relative h-screen min-h-screen overflow-hidden"
      style={{ background: 'var(--app-bg)', color: 'var(--app-text)' }}
      aria-busy={overlayOnScreen}
    >
      {/* Inert rather than aria-hidden: dimming alone leaves every control behind the overlay
          reachable by keyboard, which is how a second commit could be started on top of one that
          was still writing. It also takes the subtree out of the accessibility tree on its own.
          The dimming follows the same flag, so the page never looks reachable before it is */}
      <div
        className={`flex h-full min-h-full transition duration-200 ${overlayOnScreen ? 'select-none opacity-40 grayscale' : 'opacity-100'}`}
        inert={overlayOnScreen}
      >
        <button
          type="button"
          className="app-icon-button absolute right-5 top-5 z-20 shrink-0 sm:right-8 sm:top-6"
          onClick={() => navigate(isScopedToAccount && scopedAccountPath ? scopedAccountPath : '/settings')}
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
                <h1 className="font-serif text-3xl font-normal">
                  Import Transactions
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6" style={{ color: 'var(--app-text-muted)' }}>
                  {isFirefly
                    ? 'Stage a Firefly III export before it is added to your ledger.'
                    : 'Stage one CSV transaction file before it is added to your ledger.'}
                </p>
              </div>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-3 sm:px-8 xl:overflow-hidden">
            <div className="flex min-h-full flex-col gap-8 xl:h-full xl:min-h-0 xl:flex-row">
              <aside className="flex flex-col gap-8 xl:h-full xl:w-[340px] xl:shrink-0">
                {/* An import started from an account has one source, so the choice is not offered */}
                {!isScopedToAccount && <ImportSourceStep value={dataSource} onChange={handleDataSourceChange} />}
                <div className="min-h-0 xl:flex-1">
                  {isFirefly ? <FireflyFilesStep {...fireflyWorkflow} /> : <ImportFilesStep {...workflow} />}
                </div>
              </aside>

              <div className="min-w-0 xl:h-full xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:pr-1">
                <div className="space-y-8">
                  {isFirefly ? (
                    <>
                      <FireflyExpectationsCard />
                      <FireflyAccountMappingStep {...fireflyWorkflow} />
                      <FireflyCategoryMatchingStep {...fireflyWorkflow} />
                      <FireflyBudgetImportStep {...fireflyWorkflow} />
                      <FireflyPreviewStep {...fireflyWorkflow} />
                    </>
                  ) : (
                    <>
                      <ImportColumnMappingStep {...workflow} />
                      <ImportAccountMappingStep {...workflow} />
                      <ImportCategoryMatchingStep {...workflow} />
                      <ImportMerchantMatchingStep {...workflow} />
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
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {isFirefly ? (
        <ImportProgressOverlay
          phase={fireflyWorkflow.importOverlayPhase}
          steps={fireflyWorkflow.importOverlaySteps}
          summary={fireflyWorkflow.importSummary}
          error={fireflyWorkflow.importOverlayError}
          onDone={handleDone}
          onReturnToImport={fireflyWorkflow.closeImportOverlay}
          onClosed={() => setOverlayOnScreen(false)}
        />
      ) : (
        <ImportProgressOverlay
          phase={workflow.importOverlayPhase}
          summary={workflow.importSummary}
          error={workflow.importError}
          onDone={handleDone}
          onReturnToImport={workflow.dismissImportOverlay}
          onClosed={() => setOverlayOnScreen(false)}
          onCancel={workflow.canStopImport ? workflow.cancelImport : undefined}
          onRetry={workflow.canRetryImportCommit ? workflow.retryImportCommit : undefined}
        />
      )}
    </div>
  )
}
