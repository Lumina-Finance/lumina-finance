import { motion } from 'motion/react'
import { ChevronRight, LoaderCircle, Plus, Trash2 } from 'lucide-react'
import type { RefObject } from 'react'
import type {
  TaxAdvantagedCategory,
  TaxAdvantagedCategoryLimit,
} from '@/api/taxAdvantagedCategories'
import { formatCurrency } from '@/utils/formatCurrency'
import { LIMIT_DELETE_BUTTON_TRANSITION } from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/taxAdvantagedCategoryConstants'
import TaxAdvantagedOpeningUsageLabel from '@/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/controls/TaxAdvantagedOpeningUsageLabel'

interface TaxAdvantagedLimitsPanelProps {
  deleteConfirmYear: number | null
  hasLifetimePriorActivity: boolean
  hasScrollableLimitRows: boolean
  limitDeleteButtonRef: RefObject<HTMLButtonElement | null>
  limitDeleteConfirmLabelRef: RefObject<HTMLSpanElement | null>
  limitDeleteIdleLabelRef: RefObject<HTMLSpanElement | null>
  limitDeleteLabelWidths: { idle: number; confirm: number } | null
  limitError: string | null
  limitsLoading: boolean
  onDeleteLimit: (limit: TaxAdvantagedCategoryLimit) => void
  onSelectLimitYear: (year: number) => void
  onStartNewLimitForm: () => void
  pendingDeleteLimitYear: number | null
  plan: TaxAdvantagedCategory
  selectedLimitYear: number | null
  showAddTaxYear: boolean
  sortedLimits: TaxAdvantagedCategoryLimit[]
}

/**
 * Renders the lifetime room summary and annual TAC limits list
 */
export default function TaxAdvantagedLimitsPanel({
  deleteConfirmYear,
  hasLifetimePriorActivity,
  hasScrollableLimitRows,
  limitDeleteButtonRef,
  limitDeleteConfirmLabelRef,
  limitDeleteIdleLabelRef,
  limitDeleteLabelWidths,
  limitError,
  limitsLoading,
  onDeleteLimit,
  onSelectLimitYear,
  onStartNewLimitForm,
  pendingDeleteLimitYear,
  plan,
  selectedLimitYear,
  showAddTaxYear,
  sortedLimits,
}: TaxAdvantagedLimitsPanelProps) {
  return (
    <div className="space-y-5">
      <div className="space-y-2 border-b pb-4" style={{ borderColor: 'var(--app-border)' }}>
        <p className="text-sm font-medium">Lifetime Contribution Room</p>
        <div className="grid grid-cols-2 gap-3 min-[750px]:gap-x-8">
          <div className="grid min-w-0 gap-1 min-[750px]:grid-cols-[auto_minmax(0,1fr)] min-[750px]:items-baseline min-[750px]:gap-4">
            <span className="text-sm" style={{ color: 'var(--app-text-muted)' }}>Limit</span>
            <span className="min-w-0 truncate font-financial text-sm font-medium">
              {plan.lifetime_contribution_limit === null ? 'Not set' : formatCurrency(plan.lifetime_contribution_limit, plan.currency)}
            </span>
          </div>
          <div className="grid min-w-0 gap-1 min-[750px]:grid-cols-[auto_minmax(0,1fr)] min-[750px]:items-baseline min-[750px]:gap-4">
            <span className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
              <TaxAdvantagedOpeningUsageLabel />
            </span>
            <span className="min-w-0 truncate text-sm font-medium">
              {hasLifetimePriorActivity ? 'Noted' : 'None'}
            </span>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-3 min-[750px]:flex-row min-[750px]:items-center min-[750px]:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium">Annual Limits</p>
          <p className="text-[0.9375rem]" style={{ color: 'var(--app-text-muted)' }}>
            Configure annual contribution and withdrawal limits.
          </p>
        </div>
        <button
          type="button"
          className="app-secondary-button w-full shrink-0 justify-center min-[750px]:w-auto"
          onClick={onStartNewLimitForm}
          disabled={showAddTaxYear}
        >
          <Plus size={15} aria-hidden />
          Add year
        </button>
      </div>

      <div>
        <div className="hidden min-[750px]:block">
          <table className="w-full table-fixed text-left text-[0.9375rem]">
            <colgroup>
              <col style={{ width: '5rem' }} />
              <col style={{ width: '25%' }} />
              <col style={{ width: '25%' }} />
              <col style={{ width: 'auto' }} />
              <col style={{ width: '3.5rem' }} />
            </colgroup>
            <thead>
              <tr style={{ color: 'var(--app-text-muted)', borderBottom: '1px solid var(--app-border)' }}>
                <th className="py-2 pr-4 font-medium" style={{ background: 'var(--app-bg)' }}>Year</th>
                <th className="py-2 pl-0 pr-4 font-medium" style={{ background: 'var(--app-bg)' }}>Contribution limit</th>
                <th className="py-2 pl-4 pr-0 font-medium" style={{ background: 'var(--app-bg)' }}>Withdrawal limit</th>
                <th className="py-2 pl-4 pr-0 font-medium" style={{ background: 'var(--app-bg)' }}>
                  <TaxAdvantagedOpeningUsageLabel />
                </th>
                <th className="py-2 pl-2 font-medium" style={{ background: 'var(--app-bg)' }} aria-label="Actions" />
              </tr>
            </thead>
          </table>
        </div>

        <div className={hasScrollableLimitRows ? 'hidden max-h-[22rem] overflow-y-auto overflow-x-hidden pr-1 min-[750px]:block' : 'hidden overflow-hidden min-[750px]:block'}>
          <table className="w-full table-fixed text-left text-[0.9375rem]">
            <colgroup>
              <col style={{ width: '5rem' }} />
              <col style={{ width: '25%' }} />
              <col style={{ width: '25%' }} />
              <col style={{ width: 'auto' }} />
              <col style={{ width: '3.5rem' }} />
            </colgroup>
            <tbody>
              {limitsLoading ? null : sortedLimits.length === 0 ? (
                <tr className="block min-[750px]:table-row">
                  <td className="block py-4 text-sm italic min-[750px]:table-cell" colSpan={5} style={{ color: 'var(--app-text-subtle)' }}>
                    No limit entries yet.
                  </td>
                </tr>
              ) : (
                sortedLimits.map((limit, index) => {
                  const isSelected = selectedLimitYear === limit.year && !showAddTaxYear
                  const confirmingDelete = deleteConfirmYear === limit.year
                  const deletingLimit = pendingDeleteLimitYear === limit.year
                  const hasPriorActivity = limit.accrued_contributions > 0 || limit.accrued_withdrawals > 0

                  return (
                    <tr
                      key={limit.year}
                      className={`grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] gap-x-3 rounded-xl border px-3.5 py-3 transition-colors duration-150 hover:bg-[var(--app-accent-soft)] min-[750px]:table-row min-[750px]:rounded-none min-[750px]:border-x-0 min-[750px]:border-t-0 min-[750px]:p-0 ${index === sortedLimits.length - 1 ? 'min-[750px]:border-b-0' : 'min-[750px]:border-b'}`}
                      style={{
                        borderColor: isSelected ? 'var(--app-accent-border)' : 'var(--app-border)',
                        background: isSelected ? 'var(--app-accent-soft)' : undefined,
                      }}
                      tabIndex={0}
                      aria-selected={isSelected}
                      onClick={() => onSelectLimitYear(limit.year)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          onSelectLimitYear(limit.year)
                        }
                      }}
                    >
                      <td className="col-start-1 row-start-1 min-w-0 py-0 pr-0 text-base font-medium min-[750px]:table-cell min-[750px]:py-3 min-[750px]:pr-4 min-[750px]:text-[0.9375rem]">
                        {limit.year}
                      </td>
                      <td className="col-span-2 row-start-2 mt-3 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t pt-3 text-sm min-[750px]:table-cell min-[750px]:mt-0 min-[750px]:border-t-0 min-[750px]:py-3 min-[750px]:pl-0 min-[750px]:pr-4">
                        <span className="font-medium min-[750px]:hidden" style={{ color: 'var(--app-text-muted)' }}>
                          Contribution
                        </span>
                        <span className="min-w-0 truncate font-financial font-medium min-[750px]:font-normal">
                          {formatCurrency(limit.contribution_limit, plan.currency)}
                        </span>
                      </td>
                      <td className="col-span-2 row-start-3 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 pt-2 text-sm min-[750px]:table-cell min-[750px]:py-3 min-[750px]:pl-4 min-[750px]:pr-0">
                        <span className="font-medium min-[750px]:hidden" style={{ color: 'var(--app-text-muted)' }}>
                          Withdrawal
                        </span>
                        <span className="min-w-0 truncate font-financial font-medium min-[750px]:font-normal">
                          {limit.withdrawal_limit === null ? (
                            <span className="font-sans text-sm font-normal" style={{ color: 'var(--app-text-muted)' }}>No limit</span>
                          ) : (
                            formatCurrency(limit.withdrawal_limit, plan.currency)
                          )}
                        </span>
                      </td>
                      <td className="col-span-2 row-start-4 min-w-0 pt-2 min-[750px]:table-cell min-[750px]:py-3 min-[750px]:pl-4 min-[750px]:pr-0">
                        {hasPriorActivity ? (
                          <span className="block truncate text-sm font-medium">
                            Noted
                          </span>
                        ) : (
                          <span className="text-sm" style={{ color: 'var(--app-text-muted)' }}>No opening usage</span>
                        )}
                      </td>
                      <td
                        className="col-start-2 row-start-1 flex items-center justify-end py-0 pl-0 min-[750px]:table-cell min-[750px]:py-3 min-[750px]:pl-2"
                      >
                        <ChevronRight size={16} className="min-[750px]:hidden" style={{ color: 'var(--app-text-subtle)' }} aria-hidden />
                        <div
                          className="hidden items-center justify-center min-[750px]:flex"
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => event.stopPropagation()}
                        >
                          <button
                            ref={confirmingDelete ? limitDeleteButtonRef : undefined}
                            type="button"
                            className="inline-flex h-7 min-w-7 items-center justify-center rounded-md px-2 text-xs font-medium transition-colors duration-150 hover:bg-[var(--app-negative-soft)]"
                            onClick={() => onDeleteLimit(limit)}
                            disabled={pendingDeleteLimitYear !== null}
                            style={{ color: confirmingDelete || deletingLimit ? 'var(--app-negative)' : 'var(--app-text-subtle)' }}
                            aria-label={confirmingDelete ? `Confirm deleting ${limit.year} limits` : `Delete ${limit.year} limits`}
                          >
                            <span
                              className="relative block"
                              style={{
                                width: limitDeleteLabelWidths
                                  ? `${confirmingDelete || deletingLimit ? limitDeleteLabelWidths.confirm : limitDeleteLabelWidths.idle}px`
                                  : 'auto',
                                height: '1rem',
                                transition: 'width 150ms ease-out',
                              }}
                            >
                              <span ref={limitDeleteIdleLabelRef} className="invisible absolute inline-flex items-center whitespace-nowrap" aria-hidden>
                                <Trash2 size={14} aria-hidden />
                              </span>
                              <span ref={limitDeleteConfirmLabelRef} className="invisible absolute inline-flex items-center whitespace-nowrap" aria-hidden>
                                Confirm
                              </span>
                              <motion.span className="absolute inset-0 inline-flex items-center justify-center" animate={{ opacity: deletingLimit ? 1 : 0 }} initial={false} transition={LIMIT_DELETE_BUTTON_TRANSITION} aria-hidden={!deletingLimit}>
                                <LoaderCircle size={14} className="animate-spin" aria-hidden />
                              </motion.span>
                              <motion.span className="absolute inset-0 inline-flex items-center justify-center" animate={{ opacity: confirmingDelete && !deletingLimit ? 1 : 0 }} initial={false} transition={LIMIT_DELETE_BUTTON_TRANSITION} aria-hidden={!confirmingDelete || deletingLimit}>
                                Confirm
                              </motion.span>
                              <motion.span className="absolute inset-0 inline-flex items-center justify-center" animate={{ opacity: confirmingDelete || deletingLimit ? 0 : 1 }} initial={false} transition={LIMIT_DELETE_BUTTON_TRANSITION} aria-hidden={confirmingDelete || deletingLimit}>
                                <Trash2 size={14} aria-hidden />
                              </motion.span>
                            </span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="space-y-3 min-[750px]:hidden">
          {limitsLoading ? null : sortedLimits.length === 0 ? (
            <p className="py-4 text-sm italic" style={{ color: 'var(--app-text-subtle)' }}>
              No limit entries yet.
            </p>
          ) : (
            sortedLimits.map((limit) => {
              const isSelected = selectedLimitYear === limit.year && !showAddTaxYear
              const hasPriorActivity = limit.accrued_contributions > 0 || limit.accrued_withdrawals > 0

              return (
                <button
                  key={limit.year}
                  type="button"
                  className="grid w-full min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)_auto] gap-x-3 rounded-xl border bg-transparent px-3.5 py-3 text-left transition-colors duration-150 hover:bg-[var(--app-accent-soft)]"
                  style={{
                    borderColor: isSelected ? 'var(--app-accent-border)' : 'var(--app-border)',
                    background: isSelected ? 'var(--app-accent-soft)' : undefined,
                    color: 'var(--app-text)',
                  }}
                  aria-label={`Edit ${limit.year} limits`}
                  onClick={() => onSelectLimitYear(limit.year)}
                >
                  <span className="col-start-1 row-start-1 min-w-0 truncate text-base font-medium">
                    {limit.year}
                  </span>
                  <ChevronRight size={16} className="col-start-2 row-start-1 self-center" style={{ color: 'var(--app-text-subtle)' }} aria-hidden />
                  <span className="col-span-2 row-start-2 mt-3 grid min-w-0 grid-cols-2 items-center gap-3 border-t pt-3 text-sm">
                    <span className="min-w-0 truncate font-medium" style={{ color: 'var(--app-text-muted)' }}>
                      Contribution
                    </span>
                    <span className="min-w-0 justify-self-end truncate text-right font-financial font-medium">
                      {formatCurrency(limit.contribution_limit, plan.currency)}
                    </span>
                  </span>
                  <span className="col-span-2 row-start-3 grid min-w-0 grid-cols-2 items-center gap-3 pt-2 text-sm">
                    <span className="min-w-0 truncate font-medium" style={{ color: 'var(--app-text-muted)' }}>
                      Withdrawal
                    </span>
                    <span className="min-w-0 justify-self-end truncate text-right font-financial font-medium">
                      {limit.withdrawal_limit === null ? (
                        <span className="font-sans text-sm font-normal" style={{ color: 'var(--app-text-muted)' }}>No limit</span>
                      ) : (
                        formatCurrency(limit.withdrawal_limit, plan.currency)
                      )}
                    </span>
                  </span>
                  <span className="col-span-2 row-start-4 grid min-w-0 grid-cols-2 items-center gap-3 pt-2 text-sm">
                    <span className="min-w-0 truncate font-medium" style={{ color: 'var(--app-text-muted)' }}>
                      Opening usage
                    </span>
                    {hasPriorActivity ? (
                      <span className="min-w-0 justify-self-end truncate text-right font-medium">
                        Noted
                      </span>
                    ) : (
                      <span className="min-w-0 justify-self-end truncate text-right" style={{ color: 'var(--app-text-muted)' }}>No opening usage</span>
                    )}
                  </span>
                </button>
              )
            })
          )}
        </div>
      </div>

      {limitError && (
        <p className="text-sm" style={{ color: 'var(--app-negative)' }}>
          {limitError}
        </p>
      )}
    </div>
  )
}
