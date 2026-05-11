import { useEffect, useMemo, useRef, useState, type FormEvent, type UIEvent } from 'react'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowDown, Check, Pencil, Plus, Search, Store, Trash2, X } from 'lucide-react'
import { ApiError } from '@/api/auth'
import { useCategories, type Category } from '@/api/categories'
import {
  useDeleteMerchant,
  useInfiniteMerchants,
  useMergeMerchant,
  useUpdateMerchant,
  type Merchant,
} from '@/api/merchants'
import { merchantKeys } from '@/api/queryKeys'
import CreateMerchantModal, { NO_DEFAULT_CATEGORY_VALUE } from '@/components/CreateMerchantModal'
import Dropdown, { type DropdownOption } from '@/components/Dropdown'
import MarqueeText from '@/components/MarqueeText'
import { useMinimumVisibleFlag } from '@/hooks/useMinimumVisibleFlag'
import SectionHeader from '@/settings/components/SectionHeader'
import SettingsCard from '@/settings/components/SettingsCard'

const DELETE_SPINNER_MS = 800
const NO_CATEGORY_VALUE = NO_DEFAULT_CATEGORY_VALUE
const EASE = [0.25, 0.1, 0.25, 1] as const
const LOADING_TEXT_MIN_MS = 300
const FETCHING_MORE_TEXT_MIN_MS = 800
const MERCHANT_SEARCH_DEBOUNCE_MS = 300
const MERCHANT_LIST_VISIBLE_ROWS = 10
const MERCHANT_LIST_PAGE_SIZE = MERCHANT_LIST_VISIBLE_ROWS
const MERCHANT_MERGE_PAGE_SIZE = 10
const MERCHANT_MORE_BUTTON_INITIAL = { opacity: 0, y: 6, scale: 0.96 }
const MERCHANT_MORE_BUTTON_ANIMATE = { opacity: 1, y: 0, scale: 1 }
const MERCHANT_MORE_BUTTON_EXIT = { opacity: 0, y: 6, scale: 0.96 }
const MERCHANT_MORE_BUTTON_TRANSITION = { duration: 0.2, ease: EASE }
const MERCHANT_ROW_EXIT = { opacity: 0, y: -6, scale: 0.985 }
const MERCHANT_ROW_EXIT_TRANSITION = { duration: 0.24, ease: EASE }
const CATEGORY_KIND_LABELS: Record<Category['kind'], string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
}
const CATEGORY_KIND_ORDER: Category['kind'][] = ['expense', 'income', 'transfer']

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function categoryOptions(categories: Category[]): DropdownOption[] {
  return [
    { value: NO_CATEGORY_VALUE, label: 'No default category', group: 'Default' },
    ...CATEGORY_KIND_ORDER.flatMap((kind) =>
      categories
        .filter((category) => category.kind === kind)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((category) => ({
          value: category.id,
          label: category.name,
          group: CATEGORY_KIND_LABELS[kind],
          icon: category.icon,
        })),
    ),
  ]
}

function categoryName(categoryById: Map<string, Category>, categoryId: string | null) {
  if (!categoryId) return 'No default category'
  return categoryById.get(categoryId)?.name ?? 'Unknown category'
}

function scopeLabel(merchant: Merchant) {
  return merchant.group_id ? 'Group' : 'Personal'
}

function merchantMergeOptions(merchant: Merchant, merchants: Merchant[]): DropdownOption[] {
  return merchants
    .filter((option) => {
      if (option.id === merchant.id) return false
      return merchant.group_id
        ? option.group_id === merchant.group_id
        : option.group_id === null
    })
    .map((option) => ({
      value: option.id,
      label: option.name,
      group: option.group_id ? 'Group' : 'Personal',
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

export default function MerchantSettingsSection() {
  const queryClient = useQueryClient()
  const shouldReduceMotion = useReducedMotion()
  const [search, setSearch] = useState('')
  const [activeSearch, setActiveSearch] = useState('')
  const merchantQuery = useInfiniteMerchants(
    { q: activeSearch.trim() || undefined },
    MERCHANT_LIST_PAGE_SIZE,
  )
  const { data: categories = [] } = useCategories()
  const deleteMerchant = useDeleteMerchant()
  const mergeMerchant = useMergeMerchant()
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createModalKey, setCreateModalKey] = useState(0)
  const [editingMerchantId, setEditingMerchantId] = useState<string | null>(null)
  const [confirmingDeleteMerchantId, setConfirmingDeleteMerchantId] = useState<string | null>(null)
  const [deletingMerchantId, setDeletingMerchantId] = useState<string | null>(null)
  const [mergeDeleteMerchant, setMergeDeleteMerchant] = useState<Merchant | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [locallyDeletedMerchantIds, setLocallyDeletedMerchantIds] = useState<string[]>([])
  const [visibleMerchants, setVisibleMerchants] = useState<Merchant[]>([])
  const [merchantListAtBottom, setMerchantListAtBottom] = useState(false)
  const merchantListRef = useRef<HTMLDivElement | null>(null)
  const visibleMerchantCountRef = useRef(0)
  const initialFetchStartedAtRef = useRef<number | null>(null)
  const fetchMoreStartedAtRef = useRef<number | null>(null)

  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  )
  const options = useMemo(() => categoryOptions(categories), [categories])
  const locallyDeletedMerchantIdSet = useMemo(
    () => new Set(locallyDeletedMerchantIds),
    [locallyDeletedMerchantIds],
  )
  const fetchedMerchants = useMemo(
    () => (merchantQuery.data?.pages.flat() ?? [])
      .filter((merchant) => !locallyDeletedMerchantIdSet.has(merchant.id))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name)),
    [locallyDeletedMerchantIdSet, merchantQuery.data],
  )
  const fetchedMerchantKey = useMemo(
    () => fetchedMerchants.map((merchant) => merchant.id).join('|'),
    [fetchedMerchants],
  )
  const visibleMerchantKey = useMemo(
    () => visibleMerchants.map((merchant) => merchant.id).join('|'),
    [visibleMerchants],
  )
  const hasUndisplayedFetchedMerchants = (
    fetchedMerchantKey !== visibleMerchantKey &&
    fetchedMerchants.length > visibleMerchants.length &&
    visibleMerchants.length > 0
  )
  const showInitialMerchantLoading = useMinimumVisibleFlag(
    merchantQuery.isLoading,
    LOADING_TEXT_MIN_MS,
  )
  const showFetchingMoreMerchants = useMinimumVisibleFlag(
    merchantQuery.isFetchingNextPage || hasUndisplayedFetchedMerchants,
    FETCHING_MORE_TEXT_MIN_MS,
  )
  const hasMoreMerchants = !!merchantQuery.hasNextPage
  const canFetchMoreMerchants = hasMoreMerchants && !merchantQuery.isFetchingNextPage && !showFetchingMoreMerchants
  const shouldScrollMerchants = (
    visibleMerchants.length >= MERCHANT_LIST_VISIBLE_ROWS &&
    (hasMoreMerchants || visibleMerchants.length > MERCHANT_LIST_VISIBLE_ROWS || showFetchingMoreMerchants)
  )
  const showMerchantListMoreIndicator = shouldScrollMerchants && !merchantListAtBottom && !showFetchingMoreMerchants
  const showMerchantListEnd = shouldScrollMerchants && !hasMoreMerchants && merchantListAtBottom

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setActiveSearch(search)
    }, MERCHANT_SEARCH_DEBOUNCE_MS)

    return () => window.clearTimeout(timeoutId)
  }, [search])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setVisibleMerchants([])
      setMerchantListAtBottom(false)
      visibleMerchantCountRef.current = 0
      initialFetchStartedAtRef.current = performance.now()
      fetchMoreStartedAtRef.current = null
      if (merchantListRef.current) merchantListRef.current.scrollTop = 0
    })

    return () => window.cancelAnimationFrame(frame)
  }, [activeSearch])

  useEffect(() => {
    visibleMerchantCountRef.current = visibleMerchants.length
  }, [visibleMerchants.length])

  useEffect(() => {
    if (merchantQuery.isLoading) {
      initialFetchStartedAtRef.current = performance.now()
    }
  }, [merchantQuery.isLoading])

  useEffect(() => {
    if (merchantQuery.isFetchingNextPage) {
      fetchMoreStartedAtRef.current = performance.now()
    }
  }, [merchantQuery.isFetchingNextPage])

  useEffect(() => {
    if (fetchedMerchantKey === visibleMerchantKey) return undefined

    const isAppendingPage = fetchedMerchants.length > visibleMerchantCountRef.current && visibleMerchantCountRef.current > 0
    const isInitialPage = fetchedMerchants.length > 0 && visibleMerchantCountRef.current === 0
    const now = performance.now()
    const fetchStartedAt = isAppendingPage
      ? fetchMoreStartedAtRef.current
      : initialFetchStartedAtRef.current
    const elapsed = fetchStartedAt === null ? LOADING_TEXT_MIN_MS : now - fetchStartedAt
    const shouldDelay = isAppendingPage || isInitialPage
    const minimumVisibleMs = isAppendingPage ? FETCHING_MORE_TEXT_MIN_MS : LOADING_TEXT_MIN_MS
    const delayMs = shouldDelay ? Math.max(minimumVisibleMs - elapsed, 0) : 0
    const timeoutId = window.setTimeout(() => {
      setVisibleMerchants(fetchedMerchants)
      if (isInitialPage) initialFetchStartedAtRef.current = null
      if (isAppendingPage) fetchMoreStartedAtRef.current = null
    }, delayMs)

    return () => window.clearTimeout(timeoutId)
  }, [fetchedMerchantKey, fetchedMerchants, visibleMerchantKey])

  useEffect(() => {
    if (hasMoreMerchants || !shouldScrollMerchants) return

    const frame = window.requestAnimationFrame(() => {
      const list = merchantListRef.current
      if (!list) return

      const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 4
      if (atBottom) setMerchantListAtBottom(true)
    })

    return () => window.cancelAnimationFrame(frame)
  }, [hasMoreMerchants, shouldScrollMerchants, visibleMerchants.length])

  const handleMerchantListScroll = (event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget
    const atBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 4
    if (!atBottom) {
      setMerchantListAtBottom(false)
      return
    }

    if (canFetchMoreMerchants) {
      fetchMoreStartedAtRef.current = performance.now()
      merchantQuery.fetchNextPage()
      setMerchantListAtBottom(false)
    } else if (!hasMoreMerchants && !showFetchingMoreMerchants) {
      setMerchantListAtBottom(true)
    }
  }

  const handleMerchantListMoreClick = () => {
    setMerchantListAtBottom(false)
    window.requestAnimationFrame(() => {
      const list = merchantListRef.current
      if (!list) return

      const maxScrollTop = list.scrollHeight - list.clientHeight
      if (list.scrollTop >= maxScrollTop - 4) {
        if (canFetchMoreMerchants) {
          fetchMoreStartedAtRef.current = performance.now()
          merchantQuery.fetchNextPage()
        }
        return
      }

      list.scrollBy({ top: list.clientHeight * 0.45, behavior: 'smooth' })
    })
  }

  const handleDelete = async (merchant: Merchant) => {
    setDeleteError(null)
    setDeletingMerchantId(merchant.id)

    const deleteResult = await Promise.allSettled([
      deleteMerchant.mutateAsync(merchant.id),
      delay(DELETE_SPINNER_MS),
    ])

    if (deleteResult[0].status === 'fulfilled') {
      setLocallyDeletedMerchantIds((ids) => ids.includes(merchant.id) ? ids : [...ids, merchant.id])
      setVisibleMerchants((merchants) => merchants.filter((item) => item.id !== merchant.id))
      queryClient.invalidateQueries({ queryKey: merchantKeys.all, exact: false })
      setConfirmingDeleteMerchantId(null)
    } else {
      const error = deleteResult[0].reason
      if (error instanceof ApiError && error.status === 409) {
        setConfirmingDeleteMerchantId(null)
        setMergeDeleteMerchant(merchant)
      } else {
        setDeleteError(error instanceof Error ? error.message : 'Failed to delete merchant.')
      }
    }

    setDeletingMerchantId(null)
  }

  return (
    <section id="merchants" className="scroll-mt-8">
      <SectionHeader
        title="Merchants"
        description="Manage merchant names and their default categories."
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
                placeholder="Search merchants..."
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
              Create merchant
            </button>
          </div>

          {deleteError && (
            <p className="text-sm" style={{ color: 'var(--app-negative)' }}>
              {deleteError}
            </p>
          )}

          {visibleMerchants.length === 0 && !showInitialMerchantLoading ? (
            <p className="py-3 text-center text-sm italic" style={{ color: 'var(--app-text-subtle)' }}>
              {activeSearch.trim() ? 'No merchants match your search.' : 'No merchants yet.'}
            </p>
          ) : (
            <div className="relative">
              <div
                ref={merchantListRef}
                className={shouldScrollMerchants ? 'max-h-[35rem] min-w-0 overflow-x-auto overflow-y-auto pr-2' : 'min-w-0 overflow-x-auto'}
                onScroll={shouldScrollMerchants ? handleMerchantListScroll : undefined}
              >
                <div className="min-[750px]:hidden">
                  <AnimatePresence initial={false}>
                    {visibleMerchants.map((merchant, index) => (
                      <MobileMerchantRow
                        key={merchant.id}
                        categoryById={categoryById}
                        categoryOptions={options}
                        confirmingDelete={confirmingDeleteMerchantId === merchant.id}
                        deleting={deletingMerchantId === merchant.id}
                        isEditing={editingMerchantId === merchant.id}
                        isLast={!showMerchantListEnd && !hasMoreMerchants && index === visibleMerchants.length - 1}
                        merchant={merchant}
                        shouldReduceMotion={shouldReduceMotion}
                        onDeleteCancel={() => setConfirmingDeleteMerchantId(null)}
                        onDeleteConfirm={handleDelete}
                        onDeleteRequest={(nextMerchant) => {
                          setDeleteError(null)
                          setEditingMerchantId(null)
                          setConfirmingDeleteMerchantId(nextMerchant.id)
                        }}
                        onEdit={(nextMerchant) => setEditingMerchantId(nextMerchant.id)}
                        onEditCancel={() => setEditingMerchantId(null)}
                      />
                    ))}
                  </AnimatePresence>
                  {showMerchantListEnd && !showFetchingMoreMerchants && !showInitialMerchantLoading && (
                    <p
                      className="py-4 text-center text-sm italic"
                      style={{ color: 'var(--app-text-subtle)' }}
                    >
                      You've reached the end.
                    </p>
                  )}
                  {showFetchingMoreMerchants && visibleMerchants.length > 0 && (
                    <p
                      className="py-4 text-center text-sm italic"
                      style={{ color: 'var(--app-text-subtle)' }}
                    >
                      Fetching more
                    </p>
                  )}
                  {showInitialMerchantLoading && visibleMerchants.length === 0 && (
                    <p
                      className="py-4 text-center text-sm italic"
                      style={{ color: 'var(--app-text-subtle)' }}
                    >
                      Loading merchants...
                    </p>
                  )}
                </div>

                <table className="hidden w-full table-auto text-left text-[0.9375rem] min-[750px]:table">
                  <colgroup>
                    <col style={{ width: '1%' }} />
                    <col />
                    <col style={{ width: '7rem' }} />
                  </colgroup>
                  <thead>
                    <tr style={{ color: 'var(--app-text-muted)', borderBottom: '1px solid var(--app-border)' }}>
                      <th
                        scope="col"
                        className={`app-label whitespace-nowrap py-3 pl-4 pr-6 ${shouldScrollMerchants ? 'sticky top-0 z-10' : ''}`}
                        style={{ background: 'var(--app-surface-soft)' }}
                      >
                        Merchant
                      </th>
                      <th
                        scope="col"
                        className={`app-label py-3 pr-4 ${shouldScrollMerchants ? 'sticky top-0 z-10' : ''}`}
                        style={{ background: 'var(--app-surface-soft)' }}
                      >
                        Default category
                      </th>
                      <th
                        scope="col"
                        className={`app-label py-3 pr-4 text-right ${shouldScrollMerchants ? 'sticky top-0 z-10' : ''}`}
                        style={{ background: 'var(--app-surface-soft)' }}
                      >
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <AnimatePresence initial={false}>
                      {visibleMerchants.map((merchant, index) => (
                        <MerchantRow
                          key={merchant.id}
                          categoryById={categoryById}
                          categoryOptions={options}
                          confirmingDelete={confirmingDeleteMerchantId === merchant.id}
                          deleting={deletingMerchantId === merchant.id}
                          isEditing={editingMerchantId === merchant.id}
                          isLast={!showMerchantListEnd && !hasMoreMerchants && index === visibleMerchants.length - 1}
                          merchant={merchant}
                          shouldReduceMotion={shouldReduceMotion}
                          onDeleteCancel={() => setConfirmingDeleteMerchantId(null)}
                          onDeleteConfirm={handleDelete}
                          onDeleteRequest={(nextMerchant) => {
                            setDeleteError(null)
                            setEditingMerchantId(null)
                            setConfirmingDeleteMerchantId(nextMerchant.id)
                          }}
                          onEdit={(nextMerchant) => setEditingMerchantId(nextMerchant.id)}
                          onEditCancel={() => setEditingMerchantId(null)}
                        />
                      ))}
                    </AnimatePresence>
                    {showMerchantListEnd && !showFetchingMoreMerchants && !showInitialMerchantLoading && (
                      <tr>
                        <td colSpan={3}>
                          <p
                            className="py-4 text-center text-sm italic"
                            style={{ color: 'var(--app-text-subtle)' }}
                          >
                            You've reached the end.
                          </p>
                        </td>
                      </tr>
                    )}
                    {showFetchingMoreMerchants && visibleMerchants.length > 0 && (
                      <tr>
                        <td colSpan={3}>
                          <p
                            className="py-4 text-center text-sm italic"
                            style={{ color: 'var(--app-text-subtle)' }}
                          >
                            Fetching more
                          </p>
                        </td>
                      </tr>
                    )}
                    {showInitialMerchantLoading && visibleMerchants.length === 0 && (
                      <tr>
                        <td colSpan={3}>
                          <p
                            className="py-4 text-center text-sm italic"
                            style={{ color: 'var(--app-text-subtle)' }}
                          >
                            Loading merchants...
                          </p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <AnimatePresence initial={false}>
                {showMerchantListMoreIndicator && (
                  <motion.button
                    type="button"
                    className="absolute bottom-2 left-[calc(50%-1rem)] z-10 flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-[var(--app-button-primary-bg)] text-[var(--app-button-primary-text)] transition-colors duration-150 hover:bg-[var(--app-button-primary-bg-hover)] active:bg-[var(--app-button-primary-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent-soft)]"
                    onClick={handleMerchantListMoreClick}
                    aria-label={hasMoreMerchants ? 'Show more merchants' : 'Scroll merchants down'}
                    initial={shouldReduceMotion ? false : MERCHANT_MORE_BUTTON_INITIAL}
                    animate={shouldReduceMotion ? { opacity: 1 } : MERCHANT_MORE_BUTTON_ANIMATE}
                    exit={shouldReduceMotion ? { opacity: 0 } : MERCHANT_MORE_BUTTON_EXIT}
                    transition={MERCHANT_MORE_BUTTON_TRANSITION}
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

      <CreateMerchantModal
        key={createModalKey}
        open={showCreateModal}
        categoryOptions={options}
        onClose={() => setShowCreateModal(false)}
        onCreated={() => setShowCreateModal(false)}
      />
      <AnimatePresence>
        {mergeDeleteMerchant && (
          <MergeDeleteMerchantModal
            key={mergeDeleteMerchant.id}
            merchant={mergeDeleteMerchant}
            isPending={mergeMerchant.isPending}
            onClose={() => setMergeDeleteMerchant(null)}
            onMerge={async (replacementMerchantId) => {
              await mergeMerchant.mutateAsync({
                merchantId: mergeDeleteMerchant.id,
                payload: { replacement_merchant_id: replacementMerchantId },
              })
            }}
          />
        )}
      </AnimatePresence>
    </section>
  )
}

function MergeDeleteMerchantModal({
  merchant,
  isPending,
  onClose,
  onMerge,
}: {
  merchant: Merchant
  isPending: boolean
  onClose: () => void
  onMerge: (replacementMerchantId: string) => Promise<void>
}) {
  const [replacementSearch, setReplacementSearch] = useState('')
  const replacementQuery = useInfiniteMerchants(
    {
      group_id: merchant.group_id ?? undefined,
      q: replacementSearch.trim() || undefined,
    },
    MERCHANT_MERGE_PAGE_SIZE,
  )
  const replacementMerchants = useMemo(
    () => replacementQuery.data?.pages.flat() ?? [],
    [replacementQuery.data],
  )
  const options = useMemo(
    () => merchantMergeOptions(merchant, replacementMerchants),
    [merchant, replacementMerchants],
  )
  const [replacementMerchantId, setReplacementMerchantId] = useState(() => options[0]?.value ?? '')
  const [formError, setFormError] = useState<string | null>(null)
  const [mergeInProgress, setMergeInProgress] = useState(false)
  const selectedReplacementId = options.some((option) => option.value === replacementMerchantId)
    ? replacementMerchantId
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
      setFormError('Select a replacement merchant.')
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
      setFormError(error instanceof Error ? error.message : 'Failed to delete merchant.')
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
          aria-labelledby="merge-delete-merchant-title"
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
            <Store size={20} strokeWidth={2} />
            <span className="rotate-180 text-xs font-semibold uppercase" style={{ writingMode: 'vertical-rl' }}>
              Merchant
            </span>
          </div>

          <form className="flex min-h-0 w-full flex-col" onSubmit={handleSubmit}>
            <div className="shrink-0 px-6 pb-5 pt-6 sm:px-8 sm:pt-7" style={{ borderBottom: '1px solid var(--app-border)' }}>
              <div className="flex items-start justify-between gap-6">
                <div className="min-w-0">
                  <p className="mb-2 text-xs font-semibold uppercase" style={{ color: 'var(--app-accent)' }}>
                    Merchant in use
                  </p>
                  <h3 id="merge-delete-merchant-title" className="font-serif text-3xl font-light">
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
                      Replacement Merchant
                    </p>
                    <p className="mt-2 text-sm leading-5" style={{ color: 'var(--app-text-muted)' }}>
                      {merchant.name} is used by existing transactions. Choose another merchant for those transactions, then it can be deleted.
                    </p>
                  </div>
                  <div>
                    <label htmlFor="merge-delete-merchant-replacement" className="sr-only">Replacement merchant</label>
                    <Dropdown
                      id="merge-delete-merchant-replacement"
                      options={options}
                      value={selectedReplacementId}
                      onChange={(value) => {
                        setReplacementMerchantId(value)
                        setFormError(null)
                      }}
                      placeholder={replacementQuery.isLoading ? 'Loading merchants...' : options.length === 0 ? 'No compatible merchants' : 'Select merchant...'}
                      searchable
                      searchPlaceholder="Search merchants..."
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

function MerchantRow({
  categoryById,
  categoryOptions,
  confirmingDelete,
  deleting,
  isEditing,
  isLast,
  merchant,
  shouldReduceMotion,
  onDeleteCancel,
  onDeleteConfirm,
  onDeleteRequest,
  onEdit,
  onEditCancel,
}: {
  categoryById: Map<string, Category>
  categoryOptions: DropdownOption[]
  confirmingDelete: boolean
  deleting: boolean
  isEditing: boolean
  isLast: boolean
  merchant: Merchant
  shouldReduceMotion: boolean | null
  onDeleteCancel: () => void
  onDeleteConfirm: (merchant: Merchant) => void
  onDeleteRequest: (merchant: Merchant) => void
  onEdit: (merchant: Merchant) => void
  onEditCancel: () => void
}) {
  if (isEditing) {
    return (
      <InlineMerchantEdit
        categoryOptions={categoryOptions}
        merchant={merchant}
        isLast={isLast}
        onCancel={onEditCancel}
      />
    )
  }

  return (
    <motion.tr
      layout={!shouldReduceMotion}
      exit={shouldReduceMotion ? { opacity: 0 } : MERCHANT_ROW_EXIT}
      transition={shouldReduceMotion ? { duration: 0.12 } : MERCHANT_ROW_EXIT_TRANSITION}
      className="app-marquee-trigger"
      style={{ borderBottom: isLast ? 'none' : '1px solid var(--app-border)' }}
    >
      <td className="w-px max-w-[14rem] whitespace-nowrap py-3 pl-4 pr-6 align-middle">
        <MarqueeText className="font-medium">{merchant.name}</MarqueeText>
        <p className="truncate text-xs" style={{ color: 'var(--app-text-muted)' }}>
          {scopeLabel(merchant)}
        </p>
      </td>
      <td className="min-w-0 py-3 pr-4 align-middle">
        <p className="truncate font-medium">{categoryName(categoryById, merchant.default_category_id)}</p>
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
                aria-label={`Cancel deleting ${merchant.name}`}
                title="Cancel"
              >
                <X size={16} aria-hidden />
              </button>
              <button
                type="button"
                className="app-icon-button"
                disabled={deleting}
                onClick={() => onDeleteConfirm(merchant)}
                aria-label={`Confirm delete ${merchant.name}`}
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
                onClick={() => onEdit(merchant)}
                aria-label={`Edit ${merchant.name}`}
                title="Edit merchant"
              >
                <Pencil size={16} aria-hidden />
              </button>
              <button
                type="button"
                className="app-icon-button"
                onClick={() => onDeleteRequest(merchant)}
                aria-label={`Delete ${merchant.name}`}
                title="Delete merchant"
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

function MobileMerchantRow({
  categoryById,
  categoryOptions,
  confirmingDelete,
  deleting,
  isEditing,
  isLast,
  merchant,
  shouldReduceMotion,
  onDeleteCancel,
  onDeleteConfirm,
  onDeleteRequest,
  onEdit,
  onEditCancel,
}: {
  categoryById: Map<string, Category>
  categoryOptions: DropdownOption[]
  confirmingDelete: boolean
  deleting: boolean
  isEditing: boolean
  isLast: boolean
  merchant: Merchant
  shouldReduceMotion: boolean | null
  onDeleteCancel: () => void
  onDeleteConfirm: (merchant: Merchant) => void
  onDeleteRequest: (merchant: Merchant) => void
  onEdit: (merchant: Merchant) => void
  onEditCancel: () => void
}) {
  if (isEditing) {
    return (
      <MobileInlineMerchantEdit
        categoryOptions={categoryOptions}
        merchant={merchant}
        isLast={isLast}
        onCancel={onEditCancel}
      />
    )
  }

  return (
    <motion.div
      layout={!shouldReduceMotion}
      exit={shouldReduceMotion ? { opacity: 0 } : MERCHANT_ROW_EXIT}
      transition={shouldReduceMotion ? { duration: 0.12 } : MERCHANT_ROW_EXIT_TRANSITION}
      className="app-marquee-trigger py-3"
      style={{ borderBottom: isLast ? 'none' : '1px solid var(--app-border)' }}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2">
        <div className="min-w-0">
          <MarqueeText active className="font-medium">{merchant.name}</MarqueeText>
          <p className="truncate text-xs" style={{ color: 'var(--app-text-muted)' }}>
            {scopeLabel(merchant)}
          </p>
        </div>
        <div className="flex justify-end gap-1.5">
          {confirmingDelete ? (
            <>
              <button
                type="button"
                className="app-icon-button"
                disabled={deleting}
                onClick={onDeleteCancel}
                aria-label={`Cancel deleting ${merchant.name}`}
                title="Cancel"
              >
                <X size={16} aria-hidden />
              </button>
              <button
                type="button"
                className="app-icon-button"
                disabled={deleting}
                onClick={() => onDeleteConfirm(merchant)}
                aria-label={`Confirm delete ${merchant.name}`}
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
                onClick={() => onEdit(merchant)}
                aria-label={`Edit ${merchant.name}`}
                title="Edit merchant"
              >
                <Pencil size={16} aria-hidden />
              </button>
              <button
                type="button"
                className="app-icon-button"
                onClick={() => onDeleteRequest(merchant)}
                aria-label={`Delete ${merchant.name}`}
                title="Delete merchant"
              >
                <Trash2 size={16} aria-hidden />
              </button>
            </>
          )}
        </div>
        <div className="col-span-2 min-w-0">
          <span
            className="inline-flex max-w-full rounded-md px-2.5 py-1 text-sm font-medium"
            style={{
              background: 'var(--app-input-bg)',
              color: 'var(--app-text-muted)',
              border: '1px solid var(--app-input-border)',
            }}
          >
            <span className="truncate">{categoryName(categoryById, merchant.default_category_id)}</span>
          </span>
        </div>
      </div>
    </motion.div>
  )
}

function InlineMerchantEdit({
  categoryOptions,
  isLast,
  merchant,
  onCancel,
}: {
  categoryOptions: DropdownOption[]
  isLast: boolean
  merchant: Merchant
  onCancel: () => void
}) {
  const updateMerchant = useUpdateMerchant()
  const [form, setForm] = useState({
    name: merchant.name,
    default_category_id: merchant.default_category_id ?? NO_CATEGORY_VALUE,
  })
  const [formError, setFormError] = useState<string | null>(null)

  const setField = <K extends keyof typeof form>(field: K, value: (typeof form)[K]) => {
    setForm((current) => ({ ...current, [field]: value }))
    setFormError(null)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (updateMerchant.isPending) return

    const name = form.name.trim()
    if (!name) {
      setFormError('Name is required.')
      return
    }

    const defaultCategoryId = form.default_category_id === NO_CATEGORY_VALUE ? null : form.default_category_id
    if (name === merchant.name && defaultCategoryId === merchant.default_category_id) {
      onCancel()
      return
    }

    updateMerchant.mutate(
      {
        merchantId: merchant.id,
        payload: {
          name,
          default_category_id: defaultCategoryId,
        },
      },
      {
        onSuccess: onCancel,
        onError: (error) => {
          setFormError(error instanceof Error ? error.message : 'Failed to update merchant.')
        },
      },
    )
  }

  return (
    <tr
      style={{ borderBottom: isLast ? 'none' : '1px solid var(--app-border)' }}
    >
      <td colSpan={3} className="py-2 pl-4 pr-4 align-top">
        <form
          className="grid min-h-10 grid-cols-[minmax(9rem,14rem)_minmax(0,1fr)_7rem] items-start gap-3"
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
                value={form.name}
                onChange={(event) => setField('name', event.target.value)}
                maxLength={256}
                aria-label={`${merchant.name} name`}
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
            {formError && (
              <p className="mt-1 text-sm" style={{ color: 'var(--app-negative)' }}>
                {formError}
              </p>
            )}
            <p className="mt-1 truncate text-xs" style={{ color: 'var(--app-text-muted)' }}>
              {scopeLabel(merchant)}
            </p>
          </div>
          <div className="min-w-0">
            <Dropdown
              className="h-9 w-full rounded-md border border-[var(--app-input-border)] bg-[var(--app-input-bg)] px-2 py-0 outline-none transition-colors duration-150 hover:border-[var(--app-border-strong)] focus:border-[var(--app-accent-border)]"
              options={categoryOptions}
              value={form.default_category_id}
              onChange={(value) => setField('default_category_id', value)}
              searchable
              searchPlaceholder="Search categories..."
            />
          </div>
          <div className="flex justify-end gap-1.5">
            <button
              type="submit"
              className="app-icon-button"
              disabled={updateMerchant.isPending}
              aria-label={`Save ${merchant.name}`}
              title="Save"
            >
              {updateMerchant.isPending ? <div className="app-spinner" aria-label="Saving" /> : <Check size={16} aria-hidden />}
            </button>
            <button
              type="button"
              className="app-icon-button"
              onClick={onCancel}
              disabled={updateMerchant.isPending}
              aria-label={`Cancel editing ${merchant.name}`}
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

function MobileInlineMerchantEdit({
  categoryOptions,
  isLast,
  merchant,
  onCancel,
}: {
  categoryOptions: DropdownOption[]
  isLast: boolean
  merchant: Merchant
  onCancel: () => void
}) {
  const updateMerchant = useUpdateMerchant()
  const [form, setForm] = useState({
    name: merchant.name,
    default_category_id: merchant.default_category_id ?? NO_CATEGORY_VALUE,
  })
  const [formError, setFormError] = useState<string | null>(null)

  const setField = <K extends keyof typeof form>(field: K, value: (typeof form)[K]) => {
    setForm((current) => ({ ...current, [field]: value }))
    setFormError(null)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (updateMerchant.isPending) return

    const name = form.name.trim()
    if (!name) {
      setFormError('Name is required.')
      return
    }

    const defaultCategoryId = form.default_category_id === NO_CATEGORY_VALUE ? null : form.default_category_id
    if (name === merchant.name && defaultCategoryId === merchant.default_category_id) {
      onCancel()
      return
    }

    updateMerchant.mutate(
      {
        merchantId: merchant.id,
        payload: {
          name,
          default_category_id: defaultCategoryId,
        },
      },
      {
        onSuccess: onCancel,
        onError: (error) => {
          setFormError(error instanceof Error ? error.message : 'Failed to update merchant.')
        },
      },
    )
  }

  return (
    <form
      className="space-y-3 py-3"
      style={{ borderBottom: isLast ? 'none' : '1px solid var(--app-border)' }}
      onSubmit={handleSubmit}
      noValidate
    >
      <div className="space-y-3">
        <div>
          <span className="app-label-compact mb-1 block">Merchant</span>
          <div
            className="group flex h-9 min-w-0 items-center gap-1.5 rounded-md border px-2 transition-colors duration-150 hover:border-[var(--app-border-strong)] focus-within:border-[var(--app-accent-border)]"
            style={{
              background: 'var(--app-input-bg)',
              borderColor: 'var(--app-input-border)',
            }}
          >
            <input
              className="block h-8 min-w-0 flex-1 bg-transparent text-[0.9375rem] font-medium leading-8 outline-none"
              value={form.name}
              onChange={(event) => setField('name', event.target.value)}
              maxLength={256}
              aria-label={`${merchant.name} name`}
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
            {scopeLabel(merchant)}
          </p>
        </div>
        <div>
          <span className="app-label-compact mb-1 block">Default category</span>
          <Dropdown
            className="h-9 w-full rounded-md border border-[var(--app-input-border)] bg-[var(--app-input-bg)] px-2 py-0 outline-none transition-colors duration-150 hover:border-[var(--app-border-strong)] focus:border-[var(--app-accent-border)]"
            options={categoryOptions}
            value={form.default_category_id}
            onChange={(value) => setField('default_category_id', value)}
            searchable
            searchPlaceholder="Search categories..."
          />
        </div>
      </div>
      {formError && (
        <p className="text-sm" style={{ color: 'var(--app-negative)' }}>
          {formError}
        </p>
      )}
      <div className="flex justify-end gap-1.5">
        <button
          type="submit"
          className="app-icon-button"
          disabled={updateMerchant.isPending}
          aria-label={`Save ${merchant.name}`}
          title="Save"
        >
          {updateMerchant.isPending ? <div className="app-spinner" aria-label="Saving" /> : <Check size={16} aria-hidden />}
        </button>
        <button
          type="button"
          className="app-icon-button"
          onClick={onCancel}
          disabled={updateMerchant.isPending}
          aria-label={`Cancel editing ${merchant.name}`}
          title="Cancel"
        >
          <X size={16} aria-hidden />
        </button>
      </div>
    </form>
  )
}
