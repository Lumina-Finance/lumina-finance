import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Tag as TagIcon, X } from 'lucide-react'
import { motion } from 'motion/react'
import { useInfiniteTags, type Tag } from '@/api/tags'
import Dropdown from '@/components/Dropdown'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import {
  DELETE_SPINNER_MS,
  EASE,
  TAG_MERGE_PAGE_SIZE,
} from '@/pages/settings/components/tag-settings-section/tagSettingsConstants'
import { tagMergeOptions } from '@/pages/settings/components/tag-settings-section/tagSettingsUtils'
import { waitForMilliseconds } from '@/utils/timing'

export default function MergeDeleteTagModal({
  tag,
  isPending,
  onClose,
  onMerge,
}: {
  tag: Tag
  isPending: boolean
  onClose: () => void
  onMerge: (replacementTagId: string) => Promise<void>
}) {
  const [replacementSearch, setReplacementSearch] = useState('')
  const replacementQuery = useInfiniteTags(
    {
      group_id: tag.group_id ?? undefined,
      q: replacementSearch.trim() || undefined,
    },
    TAG_MERGE_PAGE_SIZE,
  )
  const replacementTags = useMemo(
    () => replacementQuery.data?.pages.flat() ?? [],
    [replacementQuery.data],
  )
  const options = useMemo(
    () => tagMergeOptions(tag, replacementTags),
    [tag, replacementTags],
  )
  const [replacementTagId, setReplacementTagId] = useState(() => options[0]?.value ?? '')
  const [formError, setFormError] = useState<string | null>(null)
  const [mergeInProgress, setMergeInProgress] = useState(false)
  const selectedReplacementId = options.some((option) => option.value === replacementTagId)
    ? replacementTagId
    : options[0]?.value ?? ''
  const isSubmitting = isPending || mergeInProgress

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
      setFormError('Select a replacement tag.')
      return
    }

    setFormError(null)
    setMergeInProgress(true)
    try {
      await Promise.all([
        onMerge(selectedReplacementId),
        waitForMilliseconds(DELETE_SPINNER_MS),
      ])
      onClose()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Failed to delete tag.')
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
        transition={{ duration: 0.2 }}
        onClick={isSubmitting ? undefined : onClose}
        aria-hidden
      />

      <motion.div
        className="fixed inset-0 z-[60] flex items-center justify-center p-4"
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.25, ease: EASE }}
        onClick={isSubmitting ? undefined : onClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="merge-delete-tag-title"
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
            <TagIcon size={20} strokeWidth={2} />
            <span className="rotate-180 text-xs font-semibold uppercase" style={{ writingMode: 'vertical-rl' }}>
              Tag
            </span>
          </div>

          <form className="flex min-h-0 w-full flex-col" onSubmit={handleSubmit}>
            <div className="shrink-0 px-6 pb-5 pt-6 sm:px-8 sm:pt-7" style={{ borderBottom: '1px solid var(--app-border)' }}>
              <div className="flex items-start justify-between gap-6">
                <div className="min-w-0">
                  <p className="mb-2 text-xs font-semibold uppercase" style={{ color: 'var(--app-accent)' }}>
                    Tag in use
                  </p>
                  <h3 id="merge-delete-tag-title" className="font-serif text-3xl font-light">
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
                      Replacement Tag
                    </p>
                    <p className="mt-2 text-sm leading-5" style={{ color: 'var(--app-text-muted)' }}>
                      {tag.name} is used by existing transactions. Choose another tag for those transactions, then it can be deleted.
                    </p>
                  </div>
                  <div>
                    <label htmlFor="merge-delete-tag-replacement" className="sr-only">Replacement tag</label>
                    <Dropdown
                      id="merge-delete-tag-replacement"
                      options={options}
                      value={selectedReplacementId}
                      onChange={(value) => {
                        setReplacementTagId(value)
                        setFormError(null)
                      }}
                      placeholder={replacementQuery.isLoading ? 'Loading tags...' : options.length === 0 ? 'No compatible tags' : 'Select tag...'}
                      searchable
                      searchPlaceholder="Search tags..."
                      searchValue={replacementSearch}
                      onSearchChange={setReplacementSearch}
                      filterOptions={false}
                      isLoading={replacementQuery.isLoading || replacementQuery.isFetchingNextPage}
                      hasMore={!!replacementQuery.hasNextPage}
                      onLoadMore={() => {
                        if (replacementQuery.hasNextPage && !replacementQuery.isFetchingNextPage) {
                          replacementQuery.fetchNextPage()
                        }
                      }}
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
