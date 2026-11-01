import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { readImportOrigin } from '@/utils/importOrigin'
import { useQueryClient } from '@tanstack/react-query'
import { useMinimumVisibleFlag } from '@/hooks/useMinimumVisibleFlag'
import { useToast } from '@/hooks/useToast'
import { LOADING_ANIMATION_MIN_MS } from '@/utils/timing'
import { Upload, X } from 'lucide-react'
import { TAB_OPENED_AT } from '@/api/cache/persistence'
import { accountKeys, categoryKeys, institutionKeys, merchantKeys } from '@/api/cache/queryKeys'
import { useImportSources } from '@/api/transaction-imports'
import {
  IMPORT_NOT_PERMITTED_EXPLANATION,
  IMPORT_NOT_PERMITTED_TITLE,
  IMPORT_SCOPE_FAILURE_EXPLANATION,
  IMPORT_SCOPE_FAILURE_TITLE,
} from './constants'
import {
  ImportExpectationsCard,
  ImportLoadFailure,
  ImportProgressOverlay,
  ImportSetupPanel,
  ImportUndoNoticeCard,
  LastImportCard,
} from './components'
import { hasOnlyAcceptedFiles } from './utils/setupPanel'
import { SkippedRowsReviewContext } from '@/contexts/SkippedRowsReviewContext'
import { getImportExpectations } from './expectations'
import { useActualImportWorkflow } from './actual/hooks'
import {
  ActualAccountMappingStep,
  ActualBudgetImportStep,
  ActualCategoryMatchingStep,
  ActualFilesStep,
  ActualPreviewStep,
} from './actual/sections'
import { useFireflyImportWorkflow } from './firefly/hooks'
import {
  FireflyAccountMappingStep,
  FireflyBudgetImportStep,
  FireflyCategoryMatchingStep,
  FireflyFilesStep,
  FireflyPreviewStep,
} from './firefly/sections'
import { useOfxImportWorkflow } from './ofx/hooks'
import { OfxAccountMappingStep, OfxFilesStep, OfxPreviewStep } from './ofx/sections'
import { QIF_FORMAT } from './qif/format'
import {
  useImportAccountScope,
  useImportUndoneElsewhere,
  useLastImportArrival,
  useTransactionImportWorkflow,
} from './hooks'
import { ACCOUNT_DATA_SOURCES, DEFAULT_DATA_SOURCE, getRememberedDataSource } from './utils'
import {
  chooseImportUndoOutcome,
  IMPORT_UNDONE_EMPTY_MESSAGE,
  IMPORT_UNDONE_REOPENED_MESSAGE,
  UNNAMED_IMPORT_FILE,
} from './utils/lastImport'
import {
  ImportAccountMappingStep,
  ImportAutoCreateStep,
  ImportMerchantMatchingStep,
  ImportCategoryMatchingStep,
  ImportColumnMappingStep,
  ImportFilesStep,
  ImportPreviewStep,
  ImportSourceStep,
} from './sections'
import type { ImportDataSource } from './types'

// What the header says each flow stages
const FLOW_DESCRIPTIONS: Record<ImportDataSource, string> = {
  generic: 'Stage CSV transaction files before they are added to your ledger.',
  firefly: 'Stage a Firefly III export before it is added to your ledger.',
  actual: 'Stage an Actual Budget export before it is added to your ledger.',
  ofx: 'Stage OFX or QFX statements before they are added to your ledger.',
  qif: 'Stage Quicken 3.0 (QIF) files before they are added to your ledger.',
}

// The label above the page title, by what the flow imports
const FLOW_EYEBROWS: Record<ImportDataSource, string> = {
  generic: 'CSV import',
  firefly: 'CSV import',
  actual: 'Budget import',
  ofx: 'Statement import',
  qif: 'Quicken 3.0 import',
}

/**
 * Renders the import workflow page, switching between the generic CSV, OFX/QFX, Quicken 3.0 (QIF),
 * Firefly III and Actual Budget flows and showing the shared progress overlay while a commit runs
 *
 * Only one flow can be staged at a time, so changing the data source resets whichever flow is being
 * left, so its staged state cannot leak into a later import run
 */
export default function ImportsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [dataSource, setDataSource] = useState<ImportDataSource>(DEFAULT_DATA_SOURCE)
  const accountScope = useImportAccountScope()

  // The choice on an account's page is kept apart from the general page's, which a change of query
  // string leaves mounted. It settles once per account, from the list, and then only the user changes
  // it, so a refetch landing after a file is staged can't swap the flow under it
  const [scopedChoice, setScopedChoice] = useState<{ accountId: string; source: ImportDataSource } | null>(null)
  const isChoiceSettled = scopedChoice !== null && scopedChoice.accountId === accountScope.accountId

  // The source an account's page opens on is the one last imported into it. A list already read in
  // this tab and not invalidated since settles the choice at once, and is read again in the
  // background. Otherwise the page waits for the list read as it opened, as saved CSV settings do,
  // since the cache is kept between visits: a list saved before this tab opened, or one an import has
  // invalidated since, may name a source that is no longer the last. It doesn't open on CSV and
  // switch, and a list that fails to load opens on CSV with no notice. Once settled, reading the
  // list again changes nothing
  const importSources = useImportSources(accountScope.state === 'ready')
  const hasCurrentList =
    !importSources.isStale && importSources.data !== undefined && importSources.dataUpdatedAt >= TAB_OPENED_AT
  const isWaitingForSources =
    accountScope.state === 'ready' && !isChoiceSettled && !(importSources.isError || hasCurrentList)
  const scopeLoadingVisible = useMinimumVisibleFlag(
    accountScope.state === 'loading' || isWaitingForSources,
    LOADING_ANIMATION_MIN_MS,
  )
  const scopeState = scopeLoadingVisible ? 'loading' : accountScope.state
  const workflow = useTransactionImportWorkflow(accountScope.account)
  const fireflyWorkflow = useFireflyImportWorkflow()
  const actualWorkflow = useActualImportWorkflow()
  const ofxWorkflow = useOfxImportWorkflow(accountScope.account)
  const qifWorkflow = useOfxImportWorkflow(accountScope.account, QIF_FORMAT)

  if (accountScope.accountId && accountScope.state === 'ready' && !isWaitingForSources && !isChoiceSettled) {
    setScopedChoice({
      accountId: accountScope.accountId,
      // A list that failed to load is not read, since the query keeps the data of an earlier read
      source: getRememberedDataSource(importSources.isError ? undefined : importSources.data, accountScope.accountId),
    })
  }
  const scopedSource = isChoiceSettled ? scopedChoice.source : DEFAULT_DATA_SOURCE

  // An import started from an account offers only the sources that write to one account, so the
  // provider flows, whose exports cover many, stay on the general page. Read from the scope rather
  // than from the stored choice, because a scope arriving over a staged provider export has to render
  // the account's flow without disturbing what the user had. Leaving the scope gives that export back
  const isScopedToAccount = accountScope.state === 'ready'
  const chosenSource = isScopedToAccount ? scopedSource : dataSource

  // Whichever flow is working keeps the page, whatever the scope and the stored choice say. The
  // address can gain or lose the account without remounting the page, through the link out of the
  // scope and the browser's Back button, and swapping the flow under a commit would replace the
  // overlay reporting it with an idle one and leave the page looking finished while the write was
  // still going. Read from each workflow rather than from the flow on screen, so neither can be
  // swapped away while it is the busy one
  const isFireflyBusy =
    fireflyWorkflow.importOverlayOpen || fireflyWorkflow.processingFileKind !== null || fireflyWorkflow.isImportInFlight
  const isActualBusy =
    actualWorkflow.importOverlayOpen || actualWorkflow.isProcessingFile || actualWorkflow.isImportInFlight
  const isOfxBusy = ofxWorkflow.importOverlayOpen || ofxWorkflow.isProcessingFile || ofxWorkflow.isImportInFlight
  const isQifBusy = qifWorkflow.importOverlayOpen || qifWorkflow.isProcessingFile || qifWorkflow.isImportInFlight
  const isGenericBusy = workflow.importOverlayOpen || workflow.isProcessingFiles || workflow.isImportInFlight
  const activeFlow: ImportDataSource = isFireflyBusy
    ? 'firefly'
    : isActualBusy
      ? 'actual'
      : isOfxBusy
        ? 'ofx'
        : isQifBusy
          ? 'qif'
          : isGenericBusy
            ? 'generic'
            : chosenSource

  // Every flow saves through the same import run, so the overlay reads whichever one is on screen
  // the same way
  const overlayWorkflows = {
    generic: workflow,
    firefly: fireflyWorkflow,
    actual: actualWorkflow,
    ofx: ofxWorkflow,
    qif: qifWorkflow,
  }
  const overlayWorkflow = overlayWorkflows[activeFlow]
  const importOverlayOpen = overlayWorkflow.importOverlayOpen

  // Collapses the setup panel on desktop once the flow on screen holds its files, and shows it again
  // when they go or the import is saved, so the next import's upload card and the last import's undo
  // are in view. Firefly takes three files, so it waits for all of them. A refused file or an intake
  // message keeps the panel open, since its reason is shown there. So does the OFX notice of
  // statements left out, which is the only place that says how many, for as long as the files stay
  const hasStagedFile =
    !overlayWorkflow.importResult &&
    {
      generic: hasOnlyAcceptedFiles(workflow.files) && workflow.fileIntakeError === null,
      firefly:
        [fireflyWorkflow.transactionsFile, fireflyWorkflow.budgetsFile, fireflyWorkflow.accountsFile].every(
          (file) => file !== null,
        ) &&
        hasOnlyAcceptedFiles([
          fireflyWorkflow.transactionsFile,
          fireflyWorkflow.budgetsFile,
          fireflyWorkflow.accountsFile,
        ]) &&
        Object.values(fireflyWorkflow.fileIntakeErrors).every((message) => message === null),
      actual: actualWorkflow.stagedFile !== null && actualWorkflow.fileIntakeError === null,
      ofx: ofxWorkflow.stagedFiles.length > 0 && ofxWorkflow.fileIntakeError === null && !ofxWorkflow.leftOutNotice,
      qif: qifWorkflow.stagedFiles.length > 0 && qifWorkflow.fileIntakeError === null && !qifWorkflow.leftOutNotice,
    }[activeFlow]

  // Where the page came from, which is also where its two exits go: the account while the scope
  // holds, otherwise the page that opened this one. A direct visit has neither, so each exit falls
  // back to its own default
  const scopedAccountPath = accountScope.accountId ? `/accounts/${accountScope.accountId}` : null
  const openedFromPath = readImportOrigin(location.state)
  const originPath = isScopedToAccount && scopedAccountPath ? scopedAccountPath : openedFromPath

  // The overlay covers the page for as long as it takes to fade, which is after the import it was
  // showing has already ended, so the page under it is held until it has actually gone rather than
  // until the import finished
  const [overlayOnScreen, setOverlayOnScreen] = useState(false)
  const [overlayOpener, setOverlayOpener] = useState<HTMLElement | null>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  // Counted once the overlay has gone, when the page can scroll and the overlay has handed focus back, so
  // the skipped rows list that answers it can take both
  const [skippedReviewCount, setSkippedReviewCount] = useState(0)
  const [undoCount, setUndoCount] = useState(0)
  const reviewsSkippedOnClose = useRef(false)
  if (importOverlayOpen && !overlayOnScreen) {
    setOverlayOpener(document.activeElement instanceof HTMLElement ? document.activeElement : null)
    setOverlayOnScreen(true)
  }

  // Switching source resets the flow being left, so a file still being read or an import still
  // being written would finish into a flow the user has already discarded
  const isImportBusy = overlayOnScreen || isFireflyBusy || isActualBusy || isOfxBusy || isQifBusy || isGenericBusy

  // Every mapping answer is made against these three lists, and one of them going stale sends the
  // import at a category or account that has since been renamed or deleted elsewhere. Categories in
  // particular never revalidate on their own, since their query never goes stale and the cache is
  // kept in local storage for months. Invalidating here rather than inside the reference-data hook,
  // which every workflow mounts: two refetches issued in the same commit cancel one another
  // Exact, since the account list's key is the prefix of every per-account key: without it, opening
  // this page marks each account's snapshots, cash flow and spending breakdown stale as well, and
  // the account pages refetch all of them instead of painting from the cache
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: accountKeys.list(), exact: true })
    void queryClient.invalidateQueries({ queryKey: categoryKeys.list(), exact: true })
    void queryClient.invalidateQueries({ queryKey: institutionKeys.list(), exact: true })

    // Asked again rather than read back, since a merchant created in another tab would otherwise
    // leave a merchant name reading as one with no merchant yet
    void queryClient.invalidateQueries({ queryKey: merchantKeys.nameMatchesAll })
  }, [queryClient])

  // The page owns browser file drops for its lifetime, so missing a card cannot navigate away
  useEffect(() => {
    const preventFileDropNavigation = (event: DragEvent) => event.preventDefault()
    window.addEventListener('dragover', preventFileDropNavigation)
    window.addEventListener('drop', preventFileDropNavigation)
    return () => {
      window.removeEventListener('dragover', preventFileDropNavigation)
      window.removeEventListener('drop', preventFileDropNavigation)
    }
  }, [])

  const handleDataSourceChange = (next: ImportDataSource) => {
    if (next === chosenSource || isImportBusy) return

    // The flow being switched away from resets so its staged state cannot
    // leak into a later import run
    if (chosenSource === 'generic') {
      workflow.resetImportWorkflow()
    } else if (chosenSource === 'firefly') {
      fireflyWorkflow.resetFireflyWorkflow()
    } else if (chosenSource === 'actual') {
      actualWorkflow.resetActualWorkflow()
    } else if (chosenSource === 'ofx') {
      ofxWorkflow.resetOfxWorkflow()
    } else {
      qifWorkflow.resetOfxWorkflow()
    }
    if (isScopedToAccount && accountScope.accountId) {
      setScopedChoice({ accountId: accountScope.accountId, source: next })
    } else {
      setDataSource(next)
    }
  }

  // Puts every importer right once an import is undone, whichever one saved it. The one that did gets
  // its files and answers back, unlocked. Another finished one is a record of an import that is no
  // longer the last, so it starts over empty. One still being filled in is left as it is
  const putImportersRight = (undoneRunId: string) => {
    const resets = {
      generic: workflow.resetImportWorkflow,
      firefly: fireflyWorkflow.resetFireflyWorkflow,
      actual: actualWorkflow.resetActualWorkflow,
      ofx: ofxWorkflow.resetOfxWorkflow,
      qif: qifWorkflow.resetOfxWorkflow,
    }
    let isReopened = false
    for (const flow of Object.keys(overlayWorkflows) as ImportDataSource[]) {
      const importer = overlayWorkflows[flow]
      const outcome = chooseImportUndoOutcome({
        committedRunId: importer.committedRunId,
        isFinished: importer.importResult !== null,
        undoneRunId,
      })
      if (outcome === 'reopen') {
        importer.reopenImport()
        isReopened = true
      } else if (outcome === 'reset') {
        resets[flow]()
      }
    }
    showToast({ status: 'success', text: isReopened ? IMPORT_UNDONE_REOPENED_MESSAGE : IMPORT_UNDONE_EMPTY_MESSAGE })
  }

  const handleImportUndone = (undoneRunId: string) => {
    putImportersRight(undoneRunId)
    setUndoCount((count) => count + 1)
  }

  // An import undone in another tab leaves the same finished importer here as it would in the tab
  // that undid it. Focus stays where the user has it, since no control of this page went with it
  const finishedRunId =
    Object.values(overlayWorkflows).find((importer) => importer.committedRunId !== null)?.committedRunId ?? null
  useImportUndoneElsewhere(finishedRunId, putImportersRight)

  // An import saved in another tab shows as the last import here: the setup panel opens so the card
  // is in view, the card flashes, and a screen reader hears it, since the card sits in a panel that
  // may be folded away. The importer here being finished with its own import is no arrival
  const { arrivalCount, arrivedEntry } = useLastImportArrival(finishedRunId)

  // The undo button leaves with its import, and the confirmation hands focus back to it, so focus
  // would end on the document. It is put on the page instead, a frame after the confirmation has
  // done so, which keeps a keyboard user's place instead of sending them back to the top
  useEffect(() => {
    if (undoCount === 0) return
    const frame = window.requestAnimationFrame(() => pageRef.current?.focus({ preventScroll: true }))
    return () => window.cancelAnimationFrame(frame)
  }, [undoCount])

  const handleDone = () => {
    navigate(originPath ?? '/')
  }

  // The scope is settled against the accounts list, so the page holds until that answer arrives and
  // shows no import flow at all where the answer is no. Settings is the way out of all three, since
  // none of them has an account worth returning to
  //
  // None of the three may take the page from an import that is already working. The scope holds its
  // answer once a current list has given one, but a list that has not managed to arrive settles
  // nothing, and a refetch landing during a commit would otherwise replace the overlay reporting
  // what was written. That also strands the page: the overlay is taken off screen without the exit
  // that would clear the flag dimming and disabling everything under it
  if (scopeState !== 'unscoped' && scopeState !== 'ready' && !isImportBusy) {
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

        {scopeState === 'loading' && <div className="app-spinner" role="status" aria-label="Loading" />}

        {scopeState === 'failed' && (
          <div className="w-full max-w-md">
            <ImportLoadFailure
              title={IMPORT_SCOPE_FAILURE_TITLE}
              description={IMPORT_SCOPE_FAILURE_EXPLANATION}
              onRetry={accountScope.refetchAccounts}
            />
          </div>
        )}

        {scopeState === 'unavailable' && (
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
      ref={pageRef}
      tabIndex={-1}
      className="relative h-screen min-h-screen overflow-hidden"
      style={{ background: 'var(--app-bg)', color: 'var(--app-text)' }}
    >
      {/* Inert rather than aria-hidden: dimming alone leaves every control behind the overlay
          reachable by keyboard, which is how a second commit could be started on top of one that
          was still writing. It also takes the subtree out of the accessibility tree on its own.
          The dimming follows the same flag, so the page never looks reachable before it is */}
      <div
        aria-busy={overlayOnScreen}
        className={`flex h-full min-h-full transition${overlayOnScreen ? ' select-none opacity-40 grayscale' : ' opacity-100'}`}
        inert={overlayOnScreen}
      >
        <button
          type="button"
          className="app-icon-button absolute right-5 top-5 z-20 shrink-0 sm:right-8 sm:top-6"
          onClick={() => navigate(originPath ?? '/settings')}
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
                  {FLOW_EYEBROWS[activeFlow]}
                </p>
                <h1 className="font-serif text-3xl font-normal">Import transactions</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6" style={{ color: 'var(--app-text-muted)' }}>
                  {FLOW_DESCRIPTIONS[activeFlow]}
                </p>
              </div>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-3 sm:px-8 xl:overflow-hidden">
            {/* A finished import is kept as its record, so its locked answers are shown to be read
                rather than faded as unavailable */}
            <div
              className={[
                'flex min-h-full flex-col gap-8 xl:h-full xl:min-h-0 xl:flex-row',
                overlayWorkflow.importResult && 'import-record',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {/* Each arrival replaces the line's text node, so two with the same file name are both read out */}
              <p role="status" className="sr-only">
                {arrivedEntry && (
                  <span
                    key={arrivalCount}
                  >{`Your last import changed to ${arrivedEntry.file_name ?? UNNAMED_IMPORT_FILE}.`}</span>
                )}
              </p>
              <ImportSetupPanel
                hasFile={hasStagedFile}
                onPointerInsideChange={workflow.setIsPointerInDatePanel}
                expandCount={arrivalCount}
              >
                {/* First, so the way to undo the last import is in view without scrolling the steps below */}
                <LastImportCard
                  onUndone={handleImportUndone}
                  arrival={arrivedEntry ? { count: arrivalCount, runId: arrivedEntry.id } : null}
                />
                {/* An import started from an account offers the sources that write to one account */}
                {/* Ends where the files step below it does, which keeps a gutter beside its scrolling box */}
                <div className="xl:pr-1">
                  <ImportSourceStep
                    value={chosenSource}
                    sources={isScopedToAccount ? ACCOUNT_DATA_SOURCES : undefined}
                    onChange={handleDataSourceChange}
                  />
                </div>
                <div className="min-h-0 xl:flex-1 xl:overflow-y-auto xl:pr-1">
                  {activeFlow === 'firefly' && <FireflyFilesStep {...fireflyWorkflow} />}
                  {activeFlow === 'actual' && <ActualFilesStep {...actualWorkflow} />}
                  {activeFlow === 'ofx' && <OfxFilesStep {...ofxWorkflow} />}
                  {activeFlow === 'qif' && <OfxFilesStep {...qifWorkflow} />}
                  {activeFlow === 'generic' && <ImportFilesStep {...workflow} />}
                </div>
              </ImportSetupPanel>

              <div
                role="region"
                aria-label="Import steps"
                className="min-w-0 xl:h-full xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:pr-1"
              >
                <SkippedRowsReviewContext.Provider value={skippedReviewCount}>
                  <div className="space-y-8">
                    {/* Shown whether or not a file is staged, since what the import does with one is worth
                        knowing before choosing it. Keyed by flow so each source opens with its card collapsed.
                        The undo notice sits close above it, as part of the same briefing */}
                    <div className="space-y-3">
                      <ImportUndoNoticeCard />
                      <ImportExpectationsCard
                        key={activeFlow}
                        expectations={getImportExpectations(activeFlow, accountScope.account?.name ?? null)}
                      />
                    </div>
                    {activeFlow === 'actual' && (
                      <>
                        <ActualAccountMappingStep {...actualWorkflow} />
                        <ActualCategoryMatchingStep {...actualWorkflow} />
                        <ActualBudgetImportStep {...actualWorkflow} />
                        <ActualPreviewStep {...actualWorkflow} />
                      </>
                    )}
                    {activeFlow === 'ofx' && (
                      <>
                        {/* An account's page writes the statement to that account, so there is nothing to map */}
                        {!ofxWorkflow.fixedAccount && <OfxAccountMappingStep {...ofxWorkflow} />}
                        <OfxPreviewStep {...ofxWorkflow} />
                      </>
                    )}
                    {activeFlow === 'qif' && (
                      <>
                        {/* An account's page writes the file to that account, so there is nothing to map */}
                        {!qifWorkflow.fixedAccount && <OfxAccountMappingStep {...qifWorkflow} />}
                        <OfxPreviewStep {...qifWorkflow} />
                      </>
                    )}
                    {activeFlow === 'firefly' && (
                      <>
                        <FireflyAccountMappingStep {...fireflyWorkflow} />
                        <FireflyCategoryMatchingStep {...fireflyWorkflow} />
                        <FireflyBudgetImportStep {...fireflyWorkflow} />
                        <FireflyPreviewStep {...fireflyWorkflow} />
                      </>
                    )}
                    {activeFlow === 'generic' && (
                      <>
                        <ImportColumnMappingStep {...workflow} />
                        <ImportAccountMappingStep {...workflow} />
                        <ImportCategoryMatchingStep {...workflow} />
                        <ImportMerchantMatchingStep {...workflow} />
                        <ImportAutoCreateStep
                          index="06"
                          title="Tag handling"
                          description="Tags are created when transactions are imported. If an imported tag matches an existing tag name, the transaction will use the existing tag."
                          expanded={workflow.tagHandlingOpen}
                          collapseLabel="Collapse tag handling"
                          expandLabel="Expand tag handling"
                          emptyTitle="No imported tags detected"
                          emptyDescription="Map a tags column first."
                          sourceLabel="Tag from file"
                          rows={workflow.importedTags}
                          onToggle={() => workflow.setTagHandlingOpen((current) => !current)}
                        />
                        <ImportPreviewStep {...workflow} />
                      </>
                    )}
                  </div>
                </SkippedRowsReviewContext.Provider>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ImportProgressOverlay
        onScreen={overlayOnScreen}
        returnFocusTo={overlayOpener}
        returnFocusFallbackRef={pageRef}
        phase={overlayWorkflow.importOverlayPhase}
        steps={overlayWorkflow.importOverlaySteps}
        summary={overlayWorkflow.importSummary}
        error={overlayWorkflow.importOverlayError}
        errorReason={overlayWorkflow.importOverlayErrorReason}
        errorEmphasis={overlayWorkflow.importOverlayErrorEmphasis}
        title={overlayWorkflow.importOverlayTitle}
        note={overlayWorkflow.importOverlayNote}
        onDone={handleDone}
        onReturnToImport={overlayWorkflow.closeImportOverlay}
        onReview={
          overlayWorkflow.importOverlayPhase === 'success' && overlayWorkflow.completedSkippedCount > 0
            ? () => {
                reviewsSkippedOnClose.current = true
                overlayWorkflow.closeImportOverlay()
              }
            : undefined
        }
        onClosed={() => {
          setOverlayOnScreen(false)
          if (!reviewsSkippedOnClose.current) return
          reviewsSkippedOnClose.current = false
          setSkippedReviewCount((count) => count + 1)
        }}
        onCancel={overlayWorkflow.canStopImport ? overlayWorkflow.cancelImport : undefined}
        onRetry={overlayWorkflow.canRetryImportCommit ? overlayWorkflow.retryImportCommit : undefined}
      />
    </div>
  )
}
