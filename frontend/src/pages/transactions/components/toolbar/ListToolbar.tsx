import { useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Check, ListChecks, PencilLine, Upload } from 'lucide-react'
import { DesktopToolbarControls } from '@/components/list-controls/DesktopToolbarControls'
import { GlassSearchField } from '@/components/list-controls/GlassSearchField'
import { MobileToolbarActions } from '@/components/list-controls/MobileToolbarActions'
import { ToolbarStickyShell } from '@/components/list-controls/ToolbarStickyShell'
import { getSearchFieldWrapperClassName } from '@/components/list-controls/toolbarStyles'
import { useToolbarShellState } from '@/components/list-controls/useToolbarShellState'
import { TRANSACTION_LIST_EASE } from '@/pages/transactions/constants/transactionList'
import type { TransactionListToolbarProps } from '@/pages/transactions/components/toolbar/types'
import { TransactionFilterPanel } from '@/pages/transactions/components/toolbar/FilterPanel'
import { MobileFilterPanel } from '@/pages/transactions/components/toolbar/MobileFilterPanel'
import { useToolbarStickyOffset } from '@/pages/transactions/components/toolbar/hooks/useStickyOffset'
import {
  getAccountOptions,
  getActiveFilterCount,
  getCategoryOptions,
} from '@/pages/transactions/utils/filterOptions'

/**
 * Orchestrates transaction list search, filters, and responsive toolbar layout
 */
export default function TransactionListToolbar({
  search,
  onSearchChange,
  onSearchSubmit,
  filters,
  setFilter,
  categories,
  accounts,
  showAccountFilter,
  lockedCurrency,
  onCreateTransaction,
  createDisabled = false,
  createDisabledReason,
  onImport,
  importDisabled = false,
  importDisabledReason,
  onStickyOffsetChange,
  isSelecting = false,
  selectedCount = 0,
  editDisabledReason,
  onEditSelection,
  onToggleSelecting,
}: TransactionListToolbarProps) {
  const prefersReducedMotion = useReducedMotion()

  // Set from the desktop edit button's own onAnimationStart and onAnimationComplete, so the wrap
  // layout hook holds its measurement still for exactly the span its width is changing
  const [isEditActionAnimating, setIsEditActionAnimating] = useState(false)

  // Selection mode swaps the row's own controls, and the wrap layout measures boxes rather than
  // contents, so it is told rather than left to notice
  const shell = useToolbarShellState(isSelecting ? 'selecting' : 'browsing', isEditActionAnimating)
  useToolbarStickyOffset(shell.toolbarRef, onStickyOffsetChange)

  // One node for both widths, at the 44px control height the row is built on, which the search field
  // and the collapsed filter pill it stands against both take. Square on a phone and widening for its
  // word on a desktop, but the same height throughout. The accessible name says which import this is,
  // since the word on the button cannot: on a list fixed to one account it files every row into that
  // account, and on the list of every account it is the way to the import page. The reason it is
  // blocked rides on the title alone, the way the create button's does, so the name still says what
  // the control is
  const importAction = onImport ? (
    <button
      type="button"
      className="app-glass-button h-11 w-11 shrink-0 px-0 min-[750px]:w-auto min-[750px]:px-4"
      onClick={onImport}
      disabled={importDisabled}
      title={importDisabledReason}
      aria-label={showAccountFilter ? 'Import transactions' : 'Import transactions into this account'}
    >
      <Upload size={18} aria-hidden />

      {/* The word is dropped on a phone, where the row is three controls wide and the filters button
          needs the space it would take. The accessible name carries it at both widths */}
      <span className="hidden min-[750px]:inline">Import</span>
    </button>
  ) : undefined

  // Follows the import button's shape: square on a phone, widening for its word on a desktop, at the
  // same 44px height as everything else on the row.
  //
  // The icon and the word rise out and the next pair rises in, so pressing it reads as one control
  // changing state. The label reserves the width of the longer of the two words at both states, so
  // the button itself never resizes: the desktop toolbar measures its children to decide when the
  // create button stacks, and a width easing under it could flip that decision mid-animation
  const selectAction = onToggleSelecting ? (
    <button
      type="button"
      className="app-glass-button h-11 w-11 shrink-0 overflow-hidden px-0 min-[750px]:w-auto min-[750px]:px-4"
      onClick={onToggleSelecting}
      aria-pressed={isSelecting}
      aria-label={isSelecting ? 'Stop selecting transactions' : 'Select transactions'}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={isSelecting ? 'done' : 'select'}
          className="flex items-center gap-2"
          initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 7 }}
          animate={{ opacity: 1, y: 0 }}
          exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -7 }}
          transition={{ duration: prefersReducedMotion ? 0 : 0.16, ease: TRANSACTION_LIST_EASE }}
        >
          {isSelecting ? <Check size={18} aria-hidden /> : <ListChecks size={18} aria-hidden />}
          <span className="hidden text-center min-[750px]:inline min-[750px]:w-10">
            {isSelecting ? 'Done' : 'Select'}
          </span>
        </motion.span>
      </AnimatePresence>
    </button>
  ) : undefined

  // Built to the shape of the row it sits in: square beside the other actions, and stretched on a
  // phone in selection mode, where it and Done are the only two controls on the row
  function renderEditAction(className: string) {
    if (!onEditSelection) return undefined
    const reason = editDisabledReason ?? (selectedCount === 0 ? 'Tick a transaction first' : undefined)
    return (
      <button
        type="button"
        className={className}
        onClick={onEditSelection}
        disabled={Boolean(reason)}
        title={reason}
        aria-label="Edit the selected transactions"
      >
        <PencilLine size={18} aria-hidden />
        <span className="hidden min-[750px]:inline">Edit</span>
      </button>
    )
  }

  // Animates in beside Done rather than appearing in one frame. The always-present actions keep the
  // row's own gap-3 among themselves in a group of their own; this button's trailing space instead
  // lives inside the animated box, as a margin on the button that the width animation carries along
  // with it, so the space closes with the button instead of sitting at a fixed width until the box
  // unmounts and the row's gap snaps shut behind it
  const desktopEditAction = (
    <AnimatePresence initial={false}>
      {isSelecting && onEditSelection && (
        <motion.div
          key="edit-action"
          className="overflow-hidden"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 'auto', opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: prefersReducedMotion ? 0 : 0.16, ease: TRANSACTION_LIST_EASE }}
          onAnimationStart={() => setIsEditActionAnimating(true)}
          onAnimationComplete={() => setIsEditActionAnimating(false)}
        >
          {renderEditAction('app-glass-button h-11 w-11 shrink-0 px-0 mr-3 min-[750px]:w-auto min-[750px]:px-4')}
        </motion.div>
      )}
    </AnimatePresence>
  )

  const accountOptions = useMemo(
    () => getAccountOptions(accounts),
    [accounts],
  )
  const categoryOptions = useMemo(
    () => getCategoryOptions(categories),
    [categories],
  )
  const activeFilterCount = getActiveFilterCount(filters, showAccountFilter)

  return (
    <>
      <ToolbarStickyShell
        toolbarRef={shell.toolbarRef}
        mobileSearchStickySentinelRef={shell.mobileSearchStickySentinelRef}
        toolbarStuckSentinelRef={shell.toolbarStuckSentinelRef}
        desktopInlineLayout={shell.desktopInlineLayout}
        isToolbarStuck={shell.isToolbarStuck}
      >
        <GlassSearchField
          value={search}
          onValueChange={onSearchChange}
          onSubmit={onSearchSubmit}
          placeholder="Search transactions..."
          wrapperClassName={getSearchFieldWrapperClassName(shell.mobileSearchStuck, shell.desktopInlineLayout)}
        />

        {/* Selection mode takes the phone row down to the two controls it is for. Filtering or adding
            a transaction mid-selection empties the selection anyway, so neither is worth the width */}
        {isSelecting ? (
          <div className="flex w-full items-center gap-3 min-[750px]:hidden">
            {renderEditAction('app-glass-button h-11 min-w-0 flex-1 gap-2')}
            {selectAction}
          </div>
        ) : (
          <MobileToolbarActions
            activeFilterCount={activeFilterCount}
            onOpenFilters={shell.openMobileSheet}
            onPrimaryAction={onCreateTransaction}
            primaryLabel="Add transaction"
            primaryDisabled={createDisabled}
            primaryDisabledReason={createDisabledReason}
            secondaryAction={
              <>
                {selectAction}
                {importAction}
              </>
            }
          />
        )}

        <DesktopToolbarControls
          controlsRef={shell.controlsRef}
          filterGroupRef={shell.filterGroupRef}
          createMeasureRef={shell.createMeasureRef}
          desktopInlineLayout={shell.desktopInlineLayout}
          desktopCreateStacked={shell.desktopCreateStacked}
          filterPanel={
            // Both go in the filter slot rather than beside the create button, because the layout
            // hook measures this group's own children as they render. A button placed after the
            // group instead would need its own measured twin, or the row would report itself
            // narrower than it draws and stay on one line where it no longer fits. Wrapped as one
            // child, since the group spreads its children apart once the create button stacks
            <div className="flex min-w-0 items-center">
              {desktopEditAction}
              <div className="flex min-w-0 items-center gap-3">
                {selectAction}
                {importAction}
                <TransactionFilterPanel
                  accountOptions={accountOptions}
                  categoryOptions={categoryOptions}
                  filters={filters}
                  setFilter={setFilter}
                  showAccountFilter={showAccountFilter}
                  lockedCurrency={lockedCurrency}
                />
              </div>
            </div>
          }
          createLabel="Add Transaction"
          onCreate={onCreateTransaction}
          createDisabled={createDisabled}
          createDisabledReason={createDisabledReason}
        />
      </ToolbarStickyShell>

      {shell.isMobileSheetMounted && (
        <MobileFilterPanel
          isOpen={shell.isMobileSheetOpen}
          onClose={shell.closeMobileSheet}
          onExitComplete={shell.finishMobileSheetExit}
          accountOptions={accountOptions}
          categoryOptions={categoryOptions}
          filters={filters}
          setFilter={setFilter}
          showAccountFilter={showAccountFilter}
          lockedCurrency={lockedCurrency}
        />
      )}
    </>
  )
}
