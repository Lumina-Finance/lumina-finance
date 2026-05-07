import { useEffect, useMemo, useRef, useState, type FormEvent, type UIEvent } from 'react'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowDown, Check, Pencil, Plus, Search, Tag as TagIcon, Trash2, X } from 'lucide-react'
import { ApiError } from '@/api/auth'
import { tagKeys } from '@/api/queryKeys'
import {
  useCreateTag,
  useDeleteTag,
  useInfiniteTags,
  useMergeTag,
  useUpdateTag,
  type Tag,
} from '@/api/tags'
import Dropdown, { type DropdownOption } from '@/components/Dropdown'
import { useMinimumVisibleFlag } from '@/hooks/useMinimumVisibleFlag'
import SectionHeader from '@/settings/components/SectionHeader'
import SettingsCard from '@/settings/components/SettingsCard'

const DELETE_SPINNER_MS = 800
const CREATE_TAG_MIN_LOADING_MS = 800
const EASE = [0.25, 0.1, 0.25, 1] as const
const LOADING_TEXT_MIN_MS = 300
const FETCHING_MORE_TEXT_MIN_MS = 800
const TAG_SEARCH_DEBOUNCE_MS = 300
const TAG_LIST_VISIBLE_ROWS = 10
const TAG_LIST_PAGE_SIZE = TAG_LIST_VISIBLE_ROWS
const TAG_MERGE_PAGE_SIZE = 10
const TAG_MORE_BUTTON_INITIAL = { opacity: 0, y: 6, scale: 0.96 }
const TAG_MORE_BUTTON_ANIMATE = { opacity: 1, y: 0, scale: 1 }
const TAG_MORE_BUTTON_EXIT = { opacity: 0, y: 6, scale: 0.96 }
const TAG_MORE_BUTTON_TRANSITION = { duration: 0.2, ease: EASE }
const TAG_ROW_EXIT = { opacity: 0, y: -6, scale: 0.985 }
const TAG_ROW_EXIT_TRANSITION = { duration: 0.24, ease: EASE }

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function scopeLabel(tag: Tag) {
  return tag.group_id ? 'Group' : 'Personal'
}

function tagMergeOptions(tag: Tag, tags: Tag[]): DropdownOption[] {
  return tags
    .filter((option) => {
      if (option.id === tag.id) return false
      return tag.group_id
        ? option.group_id === tag.group_id
        : option.group_id === null
    })
    .map((option) => ({
      value: option.id,
      label: option.name,
      group: option.group_id ? 'Group' : 'Personal',
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

export default function TagSettingsSection() {
  const queryClient = useQueryClient()
  const shouldReduceMotion = useReducedMotion()
  const [search, setSearch] = useState('')
  const [activeSearch, setActiveSearch] = useState('')
  const tagQuery = useInfiniteTags(
    { q: activeSearch.trim() || undefined },
    TAG_LIST_PAGE_SIZE,
  )
  const deleteTag = useDeleteTag()
  const mergeTag = useMergeTag()
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createModalKey, setCreateModalKey] = useState(0)
  const [editingTagId, setEditingTagId] = useState<string | null>(null)
  const [confirmingDeleteTagId, setConfirmingDeleteTagId] = useState<string | null>(null)
  const [deletingTagId, setDeletingTagId] = useState<string | null>(null)
  const [mergeDeleteTag, setMergeDeleteTag] = useState<Tag | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [locallyDeletedTagIds, setLocallyDeletedTagIds] = useState<string[]>([])
  const [visibleTags, setVisibleTags] = useState<Tag[]>([])
  const [tagListAtBottom, setTagListAtBottom] = useState(false)
  const tagListRef = useRef<HTMLDivElement | null>(null)
  const visibleTagCountRef = useRef(0)
  const initialFetchStartedAtRef = useRef<number | null>(null)
  const fetchMoreStartedAtRef = useRef<number | null>(null)

  const locallyDeletedTagIdSet = useMemo(
    () => new Set(locallyDeletedTagIds),
    [locallyDeletedTagIds],
  )
  const fetchedTags = useMemo(
    () => (tagQuery.data?.pages.flat() ?? [])
      .filter((tag) => !locallyDeletedTagIdSet.has(tag.id))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name)),
    [locallyDeletedTagIdSet, tagQuery.data],
  )
  const fetchedTagKey = useMemo(
    () => fetchedTags.map((tag) => tag.id).join('|'),
    [fetchedTags],
  )
  const visibleTagKey = useMemo(
    () => visibleTags.map((tag) => tag.id).join('|'),
    [visibleTags],
  )
  const hasUndisplayedFetchedTags = (
    fetchedTagKey !== visibleTagKey &&
    fetchedTags.length > visibleTags.length &&
    visibleTags.length > 0
  )
  const showInitialTagLoading = useMinimumVisibleFlag(
    tagQuery.isLoading,
    LOADING_TEXT_MIN_MS,
  )
  const showFetchingMoreTags = useMinimumVisibleFlag(
    tagQuery.isFetchingNextPage || hasUndisplayedFetchedTags,
    FETCHING_MORE_TEXT_MIN_MS,
  )
  const hasMoreTags = !!tagQuery.hasNextPage
  const canFetchMoreTags = hasMoreTags && !tagQuery.isFetchingNextPage && !showFetchingMoreTags
  const shouldScrollTags = (
    visibleTags.length >= TAG_LIST_VISIBLE_ROWS &&
    (hasMoreTags || visibleTags.length > TAG_LIST_VISIBLE_ROWS || showFetchingMoreTags)
  )
  const showTagListMoreIndicator = shouldScrollTags && !tagListAtBottom && !showFetchingMoreTags
  const showTagListEnd = shouldScrollTags && !hasMoreTags && tagListAtBottom

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setActiveSearch(search)
    }, TAG_SEARCH_DEBOUNCE_MS)

    return () => window.clearTimeout(timeoutId)
  }, [search])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setVisibleTags([])
      setTagListAtBottom(false)
      visibleTagCountRef.current = 0
      initialFetchStartedAtRef.current = performance.now()
      fetchMoreStartedAtRef.current = null
      if (tagListRef.current) tagListRef.current.scrollTop = 0
    })

    return () => window.cancelAnimationFrame(frame)
  }, [activeSearch])

  useEffect(() => {
    visibleTagCountRef.current = visibleTags.length
  }, [visibleTags.length])

  useEffect(() => {
    if (tagQuery.isLoading) {
      initialFetchStartedAtRef.current = performance.now()
    }
  }, [tagQuery.isLoading])

  useEffect(() => {
    if (tagQuery.isFetchingNextPage) {
      fetchMoreStartedAtRef.current = performance.now()
    }
  }, [tagQuery.isFetchingNextPage])

  useEffect(() => {
    if (fetchedTagKey === visibleTagKey) return undefined

    const isAppendingPage = fetchedTags.length > visibleTagCountRef.current && visibleTagCountRef.current > 0
    const isInitialPage = fetchedTags.length > 0 && visibleTagCountRef.current === 0
    const now = performance.now()
    const fetchStartedAt = isAppendingPage
      ? fetchMoreStartedAtRef.current
      : initialFetchStartedAtRef.current
    const elapsed = fetchStartedAt === null ? LOADING_TEXT_MIN_MS : now - fetchStartedAt
    const shouldDelay = isAppendingPage || isInitialPage
    const minimumVisibleMs = isAppendingPage ? FETCHING_MORE_TEXT_MIN_MS : LOADING_TEXT_MIN_MS
    const delayMs = shouldDelay ? Math.max(minimumVisibleMs - elapsed, 0) : 0
    const timeoutId = window.setTimeout(() => {
      setVisibleTags(fetchedTags)
      if (isInitialPage) initialFetchStartedAtRef.current = null
      if (isAppendingPage) fetchMoreStartedAtRef.current = null
    }, delayMs)

    return () => window.clearTimeout(timeoutId)
  }, [fetchedTagKey, fetchedTags, visibleTagKey])

  useEffect(() => {
    if (hasMoreTags || !shouldScrollTags) return

    const frame = window.requestAnimationFrame(() => {
      const list = tagListRef.current
      if (!list) return

      const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 4
      if (atBottom) setTagListAtBottom(true)
    })

    return () => window.cancelAnimationFrame(frame)
  }, [hasMoreTags, shouldScrollTags, visibleTags.length])

  const handleTagListScroll = (event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget
    const atBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 4
    if (!atBottom) {
      setTagListAtBottom(false)
      return
    }

    if (canFetchMoreTags) {
      fetchMoreStartedAtRef.current = performance.now()
      tagQuery.fetchNextPage()
      setTagListAtBottom(false)
    } else if (!hasMoreTags && !showFetchingMoreTags) {
      setTagListAtBottom(true)
    }
  }

  const handleTagListMoreClick = () => {
    setTagListAtBottom(false)
    window.requestAnimationFrame(() => {
      const list = tagListRef.current
      if (!list) return

      const maxScrollTop = list.scrollHeight - list.clientHeight
      if (list.scrollTop >= maxScrollTop - 4) {
        if (canFetchMoreTags) {
          fetchMoreStartedAtRef.current = performance.now()
          tagQuery.fetchNextPage()
        }
        return
      }

      list.scrollBy({ top: list.clientHeight * 0.45, behavior: 'smooth' })
    })
  }

  const handleDelete = async (tag: Tag) => {
    setDeleteError(null)
    setDeletingTagId(tag.id)

    const deleteResult = await Promise.allSettled([
      deleteTag.mutateAsync(tag.id),
      delay(DELETE_SPINNER_MS),
    ])

    if (deleteResult[0].status === 'fulfilled') {
      setLocallyDeletedTagIds((ids) => ids.includes(tag.id) ? ids : [...ids, tag.id])
      setVisibleTags((tags) => tags.filter((item) => item.id !== tag.id))
      queryClient.removeQueries({ queryKey: tagKeys.detail(tag.id), exact: true })
      queryClient.invalidateQueries({ queryKey: tagKeys.all, exact: false })
      setConfirmingDeleteTagId(null)
    } else {
      const error = deleteResult[0].reason
      if (error instanceof ApiError && error.status === 409) {
        setConfirmingDeleteTagId(null)
        setMergeDeleteTag(tag)
      } else {
        setDeleteError(error instanceof Error ? error.message : 'Failed to delete tag.')
      }
    }

    setDeletingTagId(null)
  }

  return (
    <section id="tags" className="scroll-mt-8">
      <SectionHeader
        title="Tags"
        description="Manage reusable labels for transaction organization."
      />

      <SettingsCard>
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--app-text-subtle)' }}
                aria-hidden
              />
              <input
                className="app-input pl-9"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  setActiveSearch(search)
                }}
                placeholder="Search tags..."
              />
            </div>
            <button
              type="button"
              className="app-primary-button shrink-0"
              onClick={() => {
                setCreateModalKey((key) => key + 1)
                setShowCreateModal(true)
              }}
            >
              <Plus size={16} aria-hidden />
              Create tag
            </button>
          </div>

          {deleteError && (
            <p className="text-sm" style={{ color: 'var(--app-negative)' }}>
              {deleteError}
            </p>
          )}

          {visibleTags.length === 0 && !showInitialTagLoading ? (
            <p className="py-3 text-center text-sm italic" style={{ color: 'var(--app-text-subtle)' }}>
              {activeSearch.trim() ? 'No tags match your search.' : 'No tags yet.'}
            </p>
          ) : (
            <div className="relative">
              <div
                ref={tagListRef}
                className={shouldScrollTags ? 'max-h-[35rem] overflow-x-auto overflow-y-auto pr-2' : 'overflow-x-auto'}
                onScroll={shouldScrollTags ? handleTagListScroll : undefined}
              >
                <table className="w-full min-w-[460px] table-fixed text-left text-[0.9375rem]">
                  <colgroup>
                    <col />
                    <col style={{ width: '7rem' }} />
                  </colgroup>
                  <thead>
                    <tr style={{ color: 'var(--app-text-muted)', borderBottom: '1px solid var(--app-border)' }}>
                      <th
                        scope="col"
                        className={`app-label py-3 pl-4 pr-4 ${shouldScrollTags ? 'sticky top-0 z-10' : ''}`}
                        style={{ background: 'var(--app-surface-soft)' }}
                      >
                        Tag
                      </th>
                      <th
                        scope="col"
                        className={`app-label py-3 pr-4 text-right ${shouldScrollTags ? 'sticky top-0 z-10' : ''}`}
                        style={{ background: 'var(--app-surface-soft)' }}
                      >
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <AnimatePresence initial={false}>
                      {visibleTags.map((tag, index) => (
                        <TagRow
                          key={tag.id}
                          confirmingDelete={confirmingDeleteTagId === tag.id}
                          deleting={deletingTagId === tag.id}
                          isEditing={editingTagId === tag.id}
                          isLast={!showTagListEnd && !hasMoreTags && index === visibleTags.length - 1}
                          shouldReduceMotion={shouldReduceMotion}
                          tag={tag}
                          onDeleteCancel={() => setConfirmingDeleteTagId(null)}
                          onDeleteConfirm={handleDelete}
                          onDeleteRequest={(nextTag) => {
                            setDeleteError(null)
                            setEditingTagId(null)
                            setConfirmingDeleteTagId(nextTag.id)
                          }}
                          onEdit={(nextTag) => setEditingTagId(nextTag.id)}
                          onEditCancel={() => setEditingTagId(null)}
                        />
                      ))}
                    </AnimatePresence>
                    {showTagListEnd && !showFetchingMoreTags && !showInitialTagLoading && (
                      <tr>
                        <td colSpan={2}>
                          <p
                            className="py-4 text-center text-sm italic"
                            style={{ color: 'var(--app-text-subtle)' }}
                          >
                            You've reached the end.
                          </p>
                        </td>
                      </tr>
                    )}
                    {showFetchingMoreTags && visibleTags.length > 0 && (
                      <tr>
                        <td colSpan={2}>
                          <p
                            className="py-4 text-center text-sm italic"
                            style={{ color: 'var(--app-text-subtle)' }}
                          >
                            Fetching more
                          </p>
                        </td>
                      </tr>
                    )}
                    {showInitialTagLoading && visibleTags.length === 0 && (
                      <tr>
                        <td colSpan={2}>
                          <p
                            className="py-4 text-center text-sm italic"
                            style={{ color: 'var(--app-text-subtle)' }}
                          >
                            Loading tags...
                          </p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <AnimatePresence initial={false}>
                {showTagListMoreIndicator && (
                  <motion.button
                    type="button"
                    className="absolute bottom-2 left-[calc(50%-1rem)] z-10 flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-[var(--app-button-primary-bg)] text-[var(--app-button-primary-text)] transition-colors duration-150 hover:bg-[var(--app-button-primary-bg-hover)] active:bg-[var(--app-button-primary-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent-soft)]"
                    onClick={handleTagListMoreClick}
                    aria-label={hasMoreTags ? 'Show more tags' : 'Scroll tags down'}
                    initial={shouldReduceMotion ? false : TAG_MORE_BUTTON_INITIAL}
                    animate={shouldReduceMotion ? { opacity: 1 } : TAG_MORE_BUTTON_ANIMATE}
                    exit={shouldReduceMotion ? { opacity: 0 } : TAG_MORE_BUTTON_EXIT}
                    transition={TAG_MORE_BUTTON_TRANSITION}
                  >
                    <span className="app-merchant-more-glyph flex items-center justify-center">
                      <ArrowDown size={19} strokeWidth={2.5} aria-hidden />
                    </span>
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </SettingsCard>

      <CreateTagModal
        key={createModalKey}
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={() => setShowCreateModal(false)}
      />
      <AnimatePresence>
        {mergeDeleteTag && (
          <MergeDeleteTagModal
            key={mergeDeleteTag.id}
            tag={mergeDeleteTag}
            isPending={mergeTag.isPending}
            onClose={() => setMergeDeleteTag(null)}
            onMerge={async (replacementTagId) => {
              await mergeTag.mutateAsync({
                tagId: mergeDeleteTag.id,
                payload: { replacement_tag_id: replacementTagId },
              })
            }}
          />
        )}
      </AnimatePresence>
    </section>
  )
}

function MergeDeleteTagModal({
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

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSubmitting) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = ''
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
        delay(DELETE_SPINNER_MS),
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
          className="flex max-h-[86vh] w-full max-w-2xl overflow-hidden rounded-2xl"
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

function TagRow({
  confirmingDelete,
  deleting,
  isEditing,
  isLast,
  shouldReduceMotion,
  tag,
  onDeleteCancel,
  onDeleteConfirm,
  onDeleteRequest,
  onEdit,
  onEditCancel,
}: {
  confirmingDelete: boolean
  deleting: boolean
  isEditing: boolean
  isLast: boolean
  shouldReduceMotion: boolean | null
  tag: Tag
  onDeleteCancel: () => void
  onDeleteConfirm: (tag: Tag) => void
  onDeleteRequest: (tag: Tag) => void
  onEdit: (tag: Tag) => void
  onEditCancel: () => void
}) {
  if (isEditing) {
    return (
      <InlineTagEdit
        tag={tag}
        isLast={isLast}
        onCancel={onEditCancel}
      />
    )
  }

  return (
    <motion.tr
      layout={!shouldReduceMotion}
      exit={shouldReduceMotion ? { opacity: 0 } : TAG_ROW_EXIT}
      transition={shouldReduceMotion ? { duration: 0.12 } : TAG_ROW_EXIT_TRANSITION}
      style={{ borderBottom: isLast ? 'none' : '1px solid var(--app-border)' }}
    >
      <td className="min-w-0 py-3 pl-4 pr-4 align-middle">
        <p className="truncate font-medium">{tag.name}</p>
        <p className="truncate text-xs" style={{ color: 'var(--app-text-muted)' }}>
          {scopeLabel(tag)}
        </p>
      </td>
      <td className="py-3 pr-4 align-middle">
        <div className="flex justify-end gap-1.5">
          {confirmingDelete ? (
            <>
              <button
                type="button"
                className="app-icon-button"
                disabled={deleting}
                onClick={onDeleteCancel}
                aria-label={`Cancel deleting ${tag.name}`}
                title="Cancel"
              >
                <X size={16} aria-hidden />
              </button>
              <button
                type="button"
                className="app-icon-button"
                disabled={deleting}
                onClick={() => onDeleteConfirm(tag)}
                aria-label={`Confirm delete ${tag.name}`}
                title="Confirm delete"
              >
                {deleting ? <div className="app-spinner" aria-label="Deleting" /> : <Check size={16} aria-hidden />}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="app-icon-button"
                onClick={() => onEdit(tag)}
                aria-label={`Edit ${tag.name}`}
                title="Edit tag"
              >
                <Pencil size={16} aria-hidden />
              </button>
              <button
                type="button"
                className="app-icon-button"
                onClick={() => onDeleteRequest(tag)}
                aria-label={`Delete ${tag.name}`}
                title="Delete tag"
              >
                <Trash2 size={16} aria-hidden />
              </button>
            </>
          )}
        </div>
      </td>
    </motion.tr>
  )
}

function InlineTagEdit({
  isLast,
  tag,
  onCancel,
}: {
  isLast: boolean
  tag: Tag
  onCancel: () => void
}) {
  const updateTag = useUpdateTag()
  const [name, setName] = useState(tag.name)
  const [formError, setFormError] = useState<string | null>(null)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (updateTag.isPending) return

    const trimmed = name.trim()
    if (!trimmed) {
      setFormError('Name is required.')
      return
    }
    if (trimmed === tag.name) {
      onCancel()
      return
    }

    updateTag.mutate(
      {
        tagId: tag.id,
        payload: { name: trimmed },
      },
      {
        onSuccess: onCancel,
        onError: (error) => {
          setFormError(error instanceof Error ? error.message : 'Failed to update tag.')
        },
      },
    )
  }

  return (
    <tr
      style={{ borderBottom: isLast ? 'none' : '1px solid var(--app-border)' }}
    >
      <td colSpan={2} className="py-2 pl-4 pr-4 align-top">
        <form
          className="grid min-h-10 grid-cols-[minmax(0,1fr)_7rem] items-start gap-3"
          onSubmit={handleSubmit}
          noValidate
        >
          <div className="min-w-0">
            <div
              className="group flex h-9 min-w-0 items-center gap-1.5 rounded-md border px-2 transition-colors duration-150 hover:border-[var(--app-border-strong)] focus-within:border-[var(--app-accent-border)]"
              style={{
                background: 'var(--app-input-bg)',
                borderColor: 'var(--app-input-border)',
              }}
            >
              <input
                className="block h-8 min-w-0 flex-1 bg-transparent text-[0.9375rem] font-medium leading-8 outline-none"
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  setFormError(null)
                }}
                maxLength={64}
                aria-label={`${tag.name} name`}
                required
                style={{ color: 'var(--app-text)' }}
              />
              <Pencil
                size={13}
                className="shrink-0 opacity-45 transition-opacity duration-150 group-hover:opacity-70 group-focus-within:opacity-80"
                style={{ color: 'var(--app-text-subtle)' }}
                aria-hidden
              />
            </div>
            <p className="mt-1 truncate text-xs" style={{ color: 'var(--app-text-muted)' }}>
              {scopeLabel(tag)}
            </p>
            {formError && (
              <p className="mt-1 text-sm" style={{ color: 'var(--app-negative)' }}>
                {formError}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-1.5">
            <button
              type="submit"
              className="app-icon-button"
              disabled={updateTag.isPending}
              aria-label={`Save ${tag.name}`}
              title="Save"
            >
              {updateTag.isPending ? <div className="app-spinner" aria-label="Saving" /> : <Check size={16} aria-hidden />}
            </button>
            <button
              type="button"
              className="app-icon-button"
              onClick={onCancel}
              disabled={updateTag.isPending}
              aria-label={`Cancel editing ${tag.name}`}
              title="Cancel"
            >
              <X size={16} aria-hidden />
            </button>
          </div>
        </form>
      </td>
    </tr>
  )
}

function CreateTagModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (tag: Tag) => void
}) {
  const createTag = useCreateTag()
  const [name, setName] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [createInProgress, setCreateInProgress] = useState(false)
  const isSubmitting = createTag.isPending || createInProgress

  useEffect(() => {
    if (!open) return undefined

    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSubmitting) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isSubmitting, onClose, open])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSubmitting) return

    const trimmed = name.trim()
    if (!trimmed) {
      setFormError('Name is required.')
      return
    }

    setCreateInProgress(true)
    const minimumLoading = delay(CREATE_TAG_MIN_LOADING_MS)

    void createTag.mutateAsync({ name: trimmed })
      .then(async (tag) => {
        await minimumLoading
        onCreated(tag)
      })
      .catch(async (error) => {
        await minimumLoading
        setFormError(error instanceof ApiError ? error.message : 'Failed to create tag.')
        setCreateInProgress(false)
      })
  }

  return createPortal(
    <AnimatePresence>
      {open && [
          <motion.div
            key="create-tag-backdrop"
            className="fixed inset-0 z-50"
            style={{ background: 'rgba(0, 0, 0, 0.35)', backdropFilter: 'blur(4px)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={isSubmitting ? undefined : onClose}
            aria-hidden
          />,

          <motion.div
            key="create-tag-panel"
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
              aria-labelledby="create-tag-title"
              className="flex max-h-[86vh] w-full max-w-2xl overflow-hidden rounded-2xl"
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

              <form className="flex min-h-0 w-full flex-col" onSubmit={handleSubmit} noValidate>
                <div className="shrink-0 px-6 pb-5 pt-6 sm:px-8 sm:pt-7" style={{ borderBottom: '1px solid var(--app-border)' }}>
                  <div className="flex items-start justify-between gap-6">
                    <div className="min-w-0">
                      <p className="mb-2 text-xs font-semibold uppercase" style={{ color: 'var(--app-accent)' }}>
                        New transaction tag
                      </p>
                      <h3 id="create-tag-title" className="font-serif text-3xl font-light">
                        Create Tag
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
                      <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>
                        Tag Name
                      </p>
                      <div>
                        <input
                          id="create-tag-name"
                          className="app-input"
                          value={name}
                          onChange={(event) => {
                            setName(event.target.value)
                            setFormError(null)
                          }}
                          maxLength={64}
                          autoFocus
                          required
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
                    className={`app-primary-button overflow-hidden whitespace-nowrap duration-300 ${isSubmitting ? 'app-primary-button-loading' : 'w-full sm:w-28'}`}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <div className="app-spinner" aria-label="Creating" />
                    ) : (
                      'Create'
                    )}
                  </button>
                </div>
              </form>
            </div>
          </motion.div>,
      ]}
    </AnimatePresence>,
    document.body,
  )
}
