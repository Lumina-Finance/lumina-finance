import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { X, type LucideIcon } from 'lucide-react'
import Dropdown, { type DropdownOption } from '@/components/dropdown/Dropdown'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import { waitForMilliseconds } from '@/utils/timing'

const BACKDROP_TRANSITION = { duration: 0.2 }
const PANEL_EASE = [0.25, 0.1, 0.25, 1] as const
const PANEL_TRANSITION = { duration: 0.25, ease: PANEL_EASE }

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
  item,
  isPending,
  submitMinVisibleMs,
  filterOptionsLocally,
  icon: Icon,
  buildOptions,
  useReplacementQuery,
  wording,
  onClose,
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
  const dropdownPlaceholder = replacementQuery.isLoading && wording.loadingPlaceholder
    ? wording.loadingPlaceholder
    : options.length === 0
      ? wording.emptyOptionsPlaceholder
      : wording.selectPlaceholder

  useBodyScrollLock(true)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSubmitting) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isSubmitting, onClose])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSubmitting) return
    if (!selectedReplacementId) {
      setFormError(wording.requireSelectionError)
      return
    }

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

  return createPortal(
    <>
      <motion.div
        className="fixed inset-0 z-50"
        style={{ background: 'rgba(0, 0, 0, 0.35)', backdropFilter: 'blur(4px)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={BACKDROP_TRANSITION}
        onClick={isSubmitting ? undefined : onClose}
        aria-hidden
      />

      <motion.div
        className="fixed inset-0 z-[60] flex items-center justify-center p-4"
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={PANEL_TRANSITION}
        onClick={isSubmitting ? undefined : onClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="app-modal-panel flex max-h-[86vh] w-full max-w-2xl overflow-hidden rounded-2xl"
          style={{
            background: 'var(--app-bg)',
            border: '1px solid var(--app-border-strong)',
            boxShadow: 'var(--app-shadow-soft)',
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div
            className="hidden w-16 shrink-0 flex-col items-center justify-between py-6 sm:flex"
            style={{
              background: 'var(--app-button-primary-bg)',
              color: 'var(--app-button-primary-text)',
            }}
            aria-hidden
          >
            <Icon size={20} strokeWidth={2} />
            <span className="rotate-180 text-xs font-semibold uppercase" style={{ writingMode: 'vertical-rl' }}>
              {wording.entityLabel}
            </span>
          </div>

          <form className="flex min-h-0 w-full flex-col" onSubmit={handleSubmit}>
            <div className="shrink-0 px-6 pb-5 pt-6 sm:px-8 sm:pt-7" style={{ borderBottom: '1px solid var(--app-border)' }}>
              <div className="flex items-start justify-between gap-6">
                <div className="min-w-0">
                  <p className="mb-2 text-xs font-semibold uppercase" style={{ color: 'var(--app-accent)' }}>
                    {wording.entityLabel} in use
                  </p>
                  <h3 id={titleId} className="font-serif text-3xl font-normal">
                    Move Transactions First
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="app-icon-button shrink-0"
                  disabled={isSubmitting}
                  aria-label="Close"
                >
                  <X size={20} aria-hidden />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-3 pt-4 sm:px-8">
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
                    <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>
                      {wording.fieldLabel}
                    </p>
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
                      placeholder={dropdownPlaceholder}
                      searchable
                      searchPlaceholder={wording.searchPlaceholder}
                      searchValue={replacementSearch}
                      onSearchChange={setReplacementSearch}
                      filterOptions={filterOptionsLocally}
                      isLoading={replacementQuery.isLoading || replacementQuery.isFetchingNextPage}
                      hasMore={replacementQuery.hasNextPage}
                      onLoadMore={replacementQuery.fetchNextPage}
                      disabled={isSubmitting || (!replacementQuery.isLoading && options.length === 0)}
                    />
                  </div>
                </div>
              </section>
            </div>

            <div
              className="flex shrink-0 flex-col-reverse gap-3 px-6 py-5 sm:flex-row sm:items-center sm:justify-end sm:px-8"
              style={{ borderTop: '1px solid var(--app-border)' }}
            >
              {formError && (
                <p className="text-sm font-medium sm:mr-auto" style={{ color: 'var(--app-negative)' }}>
                  {formError}
                </p>
              )}
              <button
                type="button"
                className="app-secondary-button w-full sm:w-auto"
                onClick={onClose}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={`app-danger-button overflow-hidden whitespace-nowrap duration-300 ${isSubmitting ? 'app-primary-button-loading' : 'w-full sm:w-40'}`}
                disabled={isSubmitting || options.length === 0}
              >
                {isSubmitting ? (
                  <div className="app-spinner" aria-label="Deleting" />
                ) : (
                  'Replace & Delete'
                )}
              </button>
            </div>
          </form>
        </div>
      </motion.div>
    </>,
    document.body,
  )
}
