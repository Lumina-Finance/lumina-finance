import { useMemo, useState, type FormEvent } from 'react'
import type { LucideIcon } from 'lucide-react'
import CreateModalSectionHeadingRow from '@/components/create-modal/SectionHeadingRow'
import { MODAL_INSET_CLASS_NAME } from '@/components/modal/inset'
import Dropdown, { type DropdownOption } from '@/components/dropdown/Dropdown'
import { FormError } from '@/components/forms/FormError'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'
import { useRefusedSubmit } from '@/hooks/useRefusedSubmit'
import { waitForMilliseconds } from '@/utils/timing'

const NO_REPLACEMENT_REASON = 'Nothing compatible to move the transactions to'

// The one field the dialogue asks for
const REPLACEMENT_FIELDS = ['replacement'] as const

interface ReplacementQueryResult<TItem> {
  replacements: TItem[]
  isLoading: boolean
  isFetchingNextPage: boolean
  hasNextPage: boolean
  fetchNextPage: () => void
}

export interface MergeDeleteReferenceModalWording {
  /** Capitalized singular noun for the entity, shown on the rail, the eyebrow text and the DOM ids */
  entityLabel: string
  fieldLabel: string
  description: string
  selectSrLabel: string
  searchPlaceholder: string
  selectPlaceholder: string
  emptyOptionsPlaceholder: string
  /** Shown while the initial replacement page is loading, omitted for a section with no remote search */
  loadingPlaceholder?: string
  requireSelectionError: string
  deleteErrorFallback: string
}

export interface MergeDeleteReferenceModalProps<TItem> {
  open: boolean
  item: TItem
  isPending: boolean
  /** Minimum time the submit spinner stays visible, matching the section's own delete spinner */
  submitMinVisibleMs: number
  /** True when the dropdown should filter the given options itself, for a list small enough to hold in full. False when the replacement query already filtered remotely and is still paging in more matches */
  filterOptionsLocally: boolean
  icon: LucideIcon
  buildOptions: (item: TItem, replacements: TItem[]) => DropdownOption[]
  useReplacementQuery: (item: TItem, search: string) => ReplacementQueryResult<TItem>
  wording: MergeDeleteReferenceModalWording
  onClose: () => void
  /** Runs once the modal has finished leaving, which the section waits on before dropping the item */
  onExitComplete: () => void
  onMerge: (replacementId: string) => Promise<void>
}

/**
 * Modal shown when a category, tag or merchant cannot be deleted because transactions still
 * reference it, asking which replacement those transactions should move to before the original
 * is removed
 *
 * Both the backdrop and the escape key stop closing the modal while the move is underway
 */
export default function MergeDeleteReferenceModal<TItem>({
  open,
  item,
  isPending,
  submitMinVisibleMs,
  filterOptionsLocally,
  icon: Icon,
  buildOptions,
  useReplacementQuery,
  wording,
  onClose,
  onExitComplete,
  onMerge,
}: MergeDeleteReferenceModalProps<TItem>) {
  const [replacementSearch, setReplacementSearch] = useState('')
  const replacementQuery = useReplacementQuery(item, replacementSearch)
  const options = useMemo(
    () => buildOptions(item, replacementQuery.replacements),
    [buildOptions, item, replacementQuery.replacements],
  )
  const [replacementId, setReplacementId] = useState(() => options[0]?.value ?? '')
  const [formError, setFormError] = useState<string | null>(null)
  const [mergeInProgress, setMergeInProgress] = useState(false)
  const selectedReplacementId = options.some((option) => option.value === replacementId)
    ? replacementId
    : options[0]?.value ?? ''
  const isSubmitting = isPending || mergeInProgress
  const idSlug = wording.entityLabel.toLowerCase()
  const titleId = `merge-delete-${idSlug}-title`
  const selectId = `merge-delete-${idSlug}-replacement`
  const errorId = `${selectId}-error`
  const hasNoReplacement = !replacementQuery.isLoading && options.length === 0
  // Only a settled empty list is a reason, since the list is also empty while it loads and while the move runs
  const noReplacementReason = !isSubmitting && hasNoReplacement ? NO_REPLACEMENT_REASON : undefined
  // A replacement is chosen for the person once the list has arrived, so one is missing only while it loads.
  // A list that settled empty is a state of its own, with nothing to fill in
  const refusal = useRefusedSubmit(
    { replacement: selectedReplacementId || hasNoReplacement ? undefined : wording.requireSelectionError },
    REPLACEMENT_FIELDS,
    { replacement: selectId },
  )
  const dropdownPlaceholder = replacementQuery.isLoading && wording.loadingPlaceholder
    ? wording.loadingPlaceholder
    : options.length === 0
      ? wording.emptyOptionsPlaceholder
      : wording.selectPlaceholder


  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSubmitting || hasNoReplacement || !refusal.guard()) return

    setFormError(null)
    setMergeInProgress(true)
    try {
      await Promise.all([
        onMerge(selectedReplacementId),
        waitForMilliseconds(submitMinVisibleMs),
      ])
      onClose()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : wording.deleteErrorFallback)
      setMergeInProgress(false)
    }
  }

  return (
    <ModalTitledPanel
      open={open}
      onExitComplete={onExitComplete}
      onClose={onClose}
      onSubmit={handleSubmit}
      titleId={titleId}
      title="Move transactions first"
      eyebrow={`${wording.entityLabel} in use`}
      RailIcon={Icon}
      railLabel={wording.entityLabel}
      closeDisabled={isSubmitting}
      footer={(
          <div
            className={`flex shrink-0 flex-col-reverse gap-3 py-5 sm:flex-row sm:items-center sm:justify-end ${MODAL_INSET_CLASS_NAME.page}`}
            style={{ borderTop: '1px solid var(--app-border)' }}
          >
            <FormError message={formError} className="sm:mr-auto" />
            <button
              type="button"
              className="app-secondary-button w-full sm:w-auto"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <DisabledReasonButton
              type="submit"
              className={`app-danger-button overflow-hidden whitespace-nowrap duration-300 ${isSubmitting ? 'app-primary-button-loading' : 'w-full sm:w-40'}`}
              disabled={isSubmitting}
              disabledReason={isSubmitting ? undefined : noReplacementReason ?? refusal.blockedReason}
            >
              {isSubmitting ? (
                <div className="app-spinner" aria-label="Deleting" />
              ) : (
                'Replace & Delete'
              )}
            </DisabledReasonButton>
          </div>
      )}
    >
        <section className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3">
          <div className="flex min-h-0 flex-col items-center">
            <span className="flex h-4 shrink-0 items-center text-xs font-semibold leading-none" style={{ color: 'var(--app-accent)' }} aria-hidden>
              01
            </span>
            <span
              className="mt-1 w-px flex-1"
              style={{ backgroundColor: 'var(--app-border-strong)' }}
              aria-hidden
            />
          </div>

          <div className="min-w-0 space-y-3">
            <div>
              <CreateModalSectionHeadingRow
                label={wording.fieldLabel}
                error={refusal.errors.replacement}
                errorId={errorId}
              />
              <p className="mt-2 text-sm leading-5" style={{ color: 'var(--app-text-muted)' }}>
                {wording.description}
              </p>
            </div>
            <div>
              <label htmlFor={selectId} className="sr-only">{wording.selectSrLabel}</label>
              <Dropdown
                id={selectId}
                options={options}
                value={selectedReplacementId}
                onChange={(value) => {
                  setReplacementId(value)
                  setFormError(null)
                }}
                hasError={!!refusal.errors.replacement}
                describedBy={refusal.errors.replacement ? errorId : undefined}
                placeholder={dropdownPlaceholder}
                searchable
                searchPlaceholder={wording.searchPlaceholder}
                searchValue={replacementSearch}
                onSearchChange={setReplacementSearch}
                filterOptions={filterOptionsLocally}
                isLoading={replacementQuery.isLoading || replacementQuery.isFetchingNextPage}
                hasMore={replacementQuery.hasNextPage}
                onLoadMore={replacementQuery.fetchNextPage}
                disabled={isSubmitting || hasNoReplacement}
                disabledReason={noReplacementReason}
              />
            </div>
          </div>
        </section>
    </ModalTitledPanel>
  )
}
