import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Picker } from 'emoji-mart'
import { AnimatePresence, motion } from 'motion/react'
import { Check, ChevronDown, Lock, Pencil, Plus, Search, Tag, Trash2, X } from 'lucide-react'
import { ApiError } from '@/api/auth'
import {
  useCategories,
  useCreateCategory,
  useDeleteCategory,
  useMergeCategory,
  useUpdateCategory,
  type Category,
} from '@/api/categories'
import { categoryKeys } from '@/api/queryKeys'
import Dropdown from '@/components/Dropdown'

type CategoryKind = Category['kind']

const KIND_LABELS: Record<CategoryKind, string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
}

const KIND_ORDER: CategoryKind[] = ['expense', 'income', 'transfer']
const KIND_OPTIONS = KIND_ORDER.map((kind) => ({ value: kind, label: KIND_LABELS[kind] }))
const DEFAULT_CATEGORY_ICON = '🏷️'
const EMOJI_MART_DATA_URL = 'https://cdn.jsdelivr.net/npm/@emoji-mart/data'
const DELETE_SPINNER_MS = 1000
const EASE = [0.25, 0.1, 0.25, 1] as const

interface EmojiMartData {
  emojis?: Record<string, unknown>
}

interface EmojiMartSelection {
  native?: string
}

type CreateCategoryField = 'icon' | 'name'
type CreateCategoryFieldErrors = Partial<Record<CreateCategoryField, string>>

const EMOJI_MART_THEME = {
  light: {
    color: '28, 21, 16',
    accent: '155, 108, 44',
    background: '242, 237, 228',
    input: '255, 255, 255',
    border: 'rgba(75, 55, 35, 0.14)',
    borderOver: 'rgba(75, 55, 35, 0.24)',
    shadow: 'var(--app-shadow-soft)',
  },
  dark: {
    color: '236, 230, 218',
    accent: '201, 169, 106',
    background: '15, 14, 12',
    input: '36, 31, 25',
    border: 'rgba(210, 180, 120, 0.12)',
    borderOver: 'rgba(210, 180, 120, 0.24)',
    shadow: 'var(--app-shadow-soft)',
  },
} as const

let emojiMartDataPromise: Promise<EmojiMartData> | null = null

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function loadEmojiMartData(): Promise<EmojiMartData> {
  if (!emojiMartDataPromise) {
    emojiMartDataPromise = fetch(EMOJI_MART_DATA_URL).then((response) => {
      if (!response.ok) throw new Error('Failed to load emoji data.')
      return response.json() as Promise<EmojiMartData>
    })
  }
  return emojiMartDataPromise
}

function displayEmoji(category: Category): string {
  return category.icon ?? DEFAULT_CATEGORY_ICON
}

function editableEmoji(icon: string | null): string {
  return icon ?? DEFAULT_CATEGORY_ICON
}

function displayKind(category: Category): CategoryKind {
  return category.kind
}

function useAppDarkMode() {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => {
      setIsDark(root.classList.contains('dark'))
    })
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return isDark
}

export default function CategorySettingsSection() {
  const queryClient = useQueryClient()
  const { data: categories = [], isLoading } = useCategories()
  const deleteCategory = useDeleteCategory()
  const mergeCategory = useMergeCategory()
  const [search, setSearch] = useState('')
  const [expandedKinds, setExpandedKinds] = useState<Set<CategoryKind>>(() => new Set())
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [confirmingDeleteCategoryId, setConfirmingDeleteCategoryId] = useState<string | null>(null)
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null)
  const [mergeDeleteCategory, setMergeDeleteCategory] = useState<Category | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const groupedCategories = useMemo(() => {
    const query = search.trim().toLowerCase()
    return KIND_ORDER.map((kind) => {
      const items = categories
        .filter((category) => displayKind(category) === kind)
        .filter((category) => !query || category.name.toLowerCase().includes(query))
      return { kind, items }
    })
  }, [categories, search])

  const hasMatches = groupedCategories.some((group) => group.items.length > 0)
  const toggleKind = (kind: CategoryKind) => {
    setExpandedKinds((current) => {
      const next = new Set(current)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }
  const handleDelete = async (category: Category) => {
    if (category.is_system) return
    setDeleteError(null)
    setDeletingCategoryId(category.id)

    const deleteResult = await Promise.allSettled([
      deleteCategory.mutateAsync(category.id),
      delay(DELETE_SPINNER_MS),
    ])

    if (deleteResult[0].status === 'fulfilled') {
      queryClient.setQueryData<Category[]>(categoryKeys.list(), (currentCategories) =>
        currentCategories?.filter((currentCategory) => currentCategory.id !== category.id) ?? currentCategories,
      )
      setConfirmingDeleteCategoryId(null)
    } else {
      const error = deleteResult[0].reason
      if (error instanceof ApiError && error.status === 409) {
        setConfirmingDeleteCategoryId(null)
        setMergeDeleteCategory(category)
      } else {
        setDeleteError(error instanceof Error ? error.message : 'Failed to delete category.')
      }
    }

    setDeletingCategoryId(null)
  }
  const handleCreated = (category: Category) => {
    setExpandedKinds((current) => new Set(current).add(category.kind))
    setShowCreateModal(false)
  }

  return (
    <section id="categories" className="scroll-mt-8">
      <SectionHeader
        title="Categories"
        description="Review system categories and manage custom categories."
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
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search categories..."
                disabled={categories.length === 0}
              />
            </div>
            <button
              type="button"
              className="app-primary-button shrink-0"
              onClick={() => setShowCreateModal(true)}
            >
              <Plus size={16} aria-hidden />
              Create category
            </button>
          </div>
          {deleteError && (
            <p className="text-sm" style={{ color: 'var(--app-negative)' }}>
              {deleteError}
            </p>
          )}

          {isLoading ? null : categories.length === 0 ? (
            <p className="py-3 text-center text-sm italic" style={{ color: 'var(--app-text-subtle)' }}>
              No categories yet.
            </p>
          ) : !hasMatches ? (
            <p className="py-3 text-center text-sm italic" style={{ color: 'var(--app-text-subtle)' }}>
              No categories match your search.
            </p>
          ) : (
            <div className="space-y-6">
              {groupedCategories.map(({ kind, items }) => (
                items.length > 0 && (
                  <CategoryGroup
                    key={kind}
                    kind={kind}
                    expanded={expandedKinds.has(kind)}
                    categories={items}
                    confirmingDeleteCategoryId={confirmingDeleteCategoryId}
                    deletingCategoryId={deletingCategoryId}
                    editingCategoryId={editingCategoryId}
                    onDeleteCancel={() => setConfirmingDeleteCategoryId(null)}
                    onDeleteConfirm={handleDelete}
                    onEdit={(category) => setEditingCategoryId(category.id)}
                    onDeleteRequest={(category) => {
                      setDeleteError(null)
                      setEditingCategoryId(null)
                      setConfirmingDeleteCategoryId(category.id)
                    }}
                    onEditCancel={() => setEditingCategoryId(null)}
                    onToggle={() => toggleKind(kind)}
                  />
                )
              ))}
            </div>
          )}
        </div>
      </SettingsCard>

      <AnimatePresence>
        {showCreateModal && (
          <CreateCategoryModal
            onClose={() => setShowCreateModal(false)}
            onCreated={handleCreated}
          />
        )}
      </AnimatePresence>
      {mergeDeleteCategory && (
        <MergeDeleteCategoryModal
          category={mergeDeleteCategory}
          categories={categories}
          isPending={mergeCategory.isPending}
          onClose={() => setMergeDeleteCategory(null)}
          onMerge={async (replacementCategoryId) => {
            await mergeCategory.mutateAsync({
              categoryId: mergeDeleteCategory.id,
              payload: { replacement_category_id: replacementCategoryId },
            })
            setMergeDeleteCategory(null)
          }}
        />
      )}
    </section>
  )
}

function CreateCategoryModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (category: Category) => void
}) {
  const createCategory = useCreateCategory()
  const [form, setForm] = useState({
    name: '',
    kind: 'expense' as CategoryKind,
    icon: '',
  })
  const [fieldErrors, setFieldErrors] = useState<CreateCategoryFieldErrors>({})
  const [touched, setTouched] = useState<Record<CreateCategoryField, boolean>>({
    icon: false,
    name: false,
  })
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const showError = (field: CreateCategoryField) => touched[field] && fieldErrors[field]
  const setField = <K extends keyof typeof form>(field: K, value: (typeof form)[K]) => {
    setForm((current) => ({ ...current, [field]: value }))
    if (field === 'icon' || field === 'name') {
      setTouched((current) => ({ ...current, [field]: true }))
      setFieldErrors((current) => ({ ...current, [field]: undefined }))
    }
    setFormError(null)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (createCategory.isPending) return

    const name = form.name.trim()
    const nextErrors: CreateCategoryFieldErrors = {}
    if (!form.icon) nextErrors.icon = 'Required'
    if (!name) nextErrors.name = 'Name is required'
    if (Object.keys(nextErrors).length > 0) {
      setTouched({ icon: true, name: true })
      setFieldErrors(nextErrors)
      return
    }

    createCategory.mutate(
      {
        name,
        kind: form.kind,
        icon: form.icon,
        group_id: null,
      },
      {
        onSuccess: onCreated,
        onError: (error) => {
          setFormError(error instanceof Error ? error.message : 'Failed to create category.')
        },
      },
    )
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
        onClick={onClose}
        aria-hidden
      />

      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.25, ease: EASE }}
        onClick={onClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-category-title"
          className="flex max-h-[86vh] w-full max-w-2xl rounded-2xl"
          style={{
            background: 'var(--app-bg)',
            border: '1px solid var(--app-border-strong)',
            boxShadow: 'var(--app-shadow-soft)',
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div
            className="hidden w-16 shrink-0 flex-col items-center justify-between rounded-l-2xl py-6 sm:flex"
            style={{
              background: 'var(--app-button-primary-bg)',
              color: 'var(--app-button-primary-text)',
            }}
            aria-hidden
          >
            <Tag size={20} strokeWidth={2} />
            <span className="rotate-180 text-xs font-semibold uppercase" style={{ writingMode: 'vertical-rl' }}>
              Category
            </span>
          </div>

          <form onSubmit={handleSubmit} className="flex min-h-0 w-full flex-col" noValidate>
            <div
              className="shrink-0 px-6 pb-5 pt-6 sm:px-8 sm:pt-7"
              style={{ borderBottom: '1px solid var(--app-border)' }}
            >
              <div className="flex items-start justify-between gap-6">
                <div className="min-w-0">
                  <p className="mb-2 text-xs font-semibold uppercase" style={{ color: 'var(--app-accent)' }}>
                    {KIND_LABELS[form.kind]} category
                  </p>
                  <h3 id="create-category-title" className="font-serif text-3xl font-light">
                    Create Category
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="app-icon-button shrink-0"
                  aria-label="Close"
                >
                  <X size={20} aria-hidden />
                </button>
              </div>
            </div>

            <div className="px-6 pb-3 pt-4 sm:px-8">
              <div className="space-y-5">
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
                    <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>Identity</p>

                    <div className="grid gap-4 sm:grid-cols-[3.5rem_minmax(0,1fr)]">
                      <div>
                        <div className="mb-1.5 flex items-start justify-between gap-3">
                          <span className="app-label block shrink-0 text-[0.9375rem] leading-5">Icon</span>
                          <AnimatePresence initial={false}>
                            {showError('icon') && (
                              <motion.p
                                key="icon-error"
                                className="text-right text-xs font-medium leading-5"
                                style={{ color: 'var(--app-negative)' }}
                                initial={{ opacity: 0, x: 4 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 4 }}
                                transition={{ duration: 0.15 }}
                              >
                                {fieldErrors.icon}
                              </motion.p>
                            )}
                          </AnimatePresence>
                        </div>
                        <CategoryIconSelector
                          categoryName={form.name || 'New category'}
                          value={form.icon}
                          onChange={(icon) => setField('icon', icon)}
                          buttonClassName={`app-input flex h-10 w-10 items-center justify-center p-0 text-xl leading-none ${showError('icon') ? 'app-input-error' : ''}`}
                          hasError={!!showError('icon')}
                        />
                      </div>

                      <div>
                        <div className="mb-1.5 flex items-start justify-between gap-3">
                          <span className="app-label block shrink-0 text-[0.9375rem] leading-5">Category name</span>
                          <AnimatePresence initial={false}>
                            {showError('name') && (
                              <motion.p
                                key="name-error"
                                className="text-right text-xs font-medium leading-5"
                                style={{ color: 'var(--app-negative)' }}
                                initial={{ opacity: 0, x: 4 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 4 }}
                                transition={{ duration: 0.15 }}
                              >
                                {fieldErrors.name}
                              </motion.p>
                            )}
                          </AnimatePresence>
                        </div>
                        <input
                          className={`app-input ${showError('name') ? 'app-input-error' : ''}`}
                          value={form.name}
                          onChange={(event) => setField('name', event.target.value)}
                          onBlur={() => setTouched((current) => ({ ...current, name: true }))}
                          placeholder="Groceries"
                          maxLength={256}
                          required
                        />
                      </div>
                    </div>
                  </div>
                </section>

                <section className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3">
                  <div className="flex min-h-0 flex-col items-center">
                    <span className="flex h-4 shrink-0 items-center text-xs font-semibold leading-none" style={{ color: 'var(--app-accent)' }} aria-hidden>
                      02
                    </span>
                    <span
                      className="mt-1 w-px flex-1"
                      style={{ backgroundColor: 'var(--app-border-strong)' }}
                      aria-hidden
                    />
                  </div>

                  <div className="min-w-0 space-y-3">
                    <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>Classification</p>
                    <div>
                      <span className="app-label mb-1.5 block text-[0.9375rem] leading-5">Category type</span>
                      <Dropdown
                        options={KIND_OPTIONS}
                        value={form.kind}
                        onChange={(value) => setField('kind', value as CategoryKind)}
                      />
                    </div>
                  </div>
                </section>

                <AnimatePresence>
                  {formError && (
                    <motion.p
                      className="text-sm font-medium"
                      style={{ color: 'var(--app-negative)' }}
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.15 }}
                    >
                      {formError}
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
            </div>

            <div
              className="flex shrink-0 flex-col-reverse gap-3 px-6 py-5 sm:flex-row sm:justify-end sm:px-8"
              style={{ borderTop: '1px solid var(--app-border)' }}
            >
              <button type="button" className="app-secondary-button w-full sm:w-auto" onClick={onClose} disabled={createCategory.isPending}>
                Cancel
              </button>
              <button
                type="submit"
                className={`app-primary-button overflow-hidden whitespace-nowrap duration-300 ${createCategory.isPending ? 'app-primary-button-loading' : 'w-full sm:w-40'}`}
                disabled={createCategory.isPending}
              >
                {createCategory.isPending ? <div className="app-spinner" aria-label="Creating" /> : 'Create Category'}
              </button>
            </div>
          </form>
        </div>
      </motion.div>
    </>,
    document.body,
  )
}

function categoryMergeOptions(category: Category, categories: Category[]) {
  return categories
    .filter((option) => {
      if (option.id === category.id || option.kind !== category.kind) return false
      if (category.group_id) return option.is_system || option.group_id === category.group_id
      return option.is_system || (!option.is_system && option.group_id === null)
    })
    .map((option) => ({
      value: option.id,
      label: option.name,
      icon: option.icon,
      group: option.is_system ? 'System' : option.group_id ? 'Group' : 'Personal',
    }))
}

function MergeDeleteCategoryModal({
  category,
  categories,
  isPending,
  onClose,
  onMerge,
}: {
  category: Category
  categories: Category[]
  isPending: boolean
  onClose: () => void
  onMerge: (replacementCategoryId: string) => Promise<void>
}) {
  const options = useMemo(() => categoryMergeOptions(category, categories), [categories, category])
  const [replacementCategoryId, setReplacementCategoryId] = useState(() => options[0]?.value ?? '')
  const [formError, setFormError] = useState<string | null>(null)
  const selectedReplacementId = options.some((option) => option.value === replacementCategoryId)
    ? replacementCategoryId
    : options[0]?.value ?? ''

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isPending) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isPending, onClose])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isPending) return
    if (!selectedReplacementId) {
      setFormError('Select a replacement category.')
      return
    }

    setFormError(null)
    try {
      await onMerge(selectedReplacementId)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Failed to delete category.')
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 z-50"
        style={{ background: 'rgba(0, 0, 0, 0.35)', backdropFilter: 'blur(4px)' }}
        onClick={isPending ? undefined : onClose}
        aria-hidden
      />

      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={isPending ? undefined : onClose}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="merge-delete-category-title"
          className="w-full max-w-lg rounded-2xl p-6 sm:p-8"
          style={{
            background: 'var(--app-bg)',
            border: '1px solid var(--app-border-strong)',
            boxShadow: 'var(--app-shadow-soft)',
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <form className="space-y-6" onSubmit={handleSubmit}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="merge-delete-category-title" className="font-serif text-2xl font-light tracking-tight">
                  Delete {category.name}
                </h3>
                <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                  Move existing references before deleting this category.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="app-icon-button shrink-0"
                disabled={isPending}
                aria-label="Close"
              >
                <X size={18} aria-hidden />
              </button>
            </div>

            <Field label="Replacement category">
              <Dropdown
                options={options}
                value={selectedReplacementId}
                onChange={(value) => {
                  setReplacementCategoryId(value)
                  setFormError(null)
                }}
                placeholder={options.length === 0 ? 'No compatible categories' : 'Select category...'}
                searchable
                disabled={isPending || options.length === 0}
              />
            </Field>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
              {formError && (
                <p className="text-sm sm:mr-auto" style={{ color: 'var(--app-negative)' }}>
                  {formError}
                </p>
              )}
              <button
                type="button"
                className="app-secondary-button"
                onClick={onClose}
                disabled={isPending}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="app-primary-button inline-flex items-center justify-center gap-2"
                disabled={isPending || options.length === 0}
              >
                {isPending ? <div className="app-spinner" aria-label="Deleting" /> : <Trash2 size={16} aria-hidden />}
                Delete category
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}

function CategoryGroup({
  categories,
  confirmingDeleteCategoryId,
  deletingCategoryId,
  editingCategoryId,
  expanded,
  kind,
  onDeleteCancel,
  onDeleteConfirm,
  onDeleteRequest,
  onEdit,
  onEditCancel,
  onToggle,
}: {
  categories: Category[]
  confirmingDeleteCategoryId: string | null
  deletingCategoryId: string | null | undefined
  editingCategoryId: string | null
  expanded: boolean
  kind: CategoryKind
  onDeleteCancel: () => void
  onDeleteConfirm: (category: Category) => void
  onDeleteRequest: (category: Category) => void
  onEdit: (category: Category) => void
  onEditCancel: () => void
  onToggle: () => void
}) {
  return (
    <div>
      <button
        type="button"
        className="flex h-11 w-full items-center justify-between gap-3 text-left"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className="min-w-0">
          <span className="app-label block">{KIND_LABELS[kind]}</span>
          <span className="block text-xs" style={{ color: 'var(--app-text-subtle)' }}>
            {categories.length} {categories.length === 1 ? 'category' : 'categories'}
          </span>
        </span>
        <ChevronDown
          size={17}
          className={`shrink-0 transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`}
          style={{ color: 'var(--app-text-subtle)' }}
          aria-hidden
        />
      </button>
      {expanded && (
        <div>
          {categories.map((category, index) => (
            <CategoryRow
              key={category.id}
              category={category}
              confirmingDelete={confirmingDeleteCategoryId === category.id}
              deleting={deletingCategoryId === category.id}
              isLast={index === categories.length - 1}
              isEditing={editingCategoryId === category.id}
              onDeleteCancel={onDeleteCancel}
              onDeleteConfirm={onDeleteConfirm}
              onDeleteRequest={onDeleteRequest}
              onEdit={onEdit}
              onEditCancel={onEditCancel}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function CategoryRow({
  category,
  confirmingDelete,
  deleting,
  isLast,
  isEditing,
  onDeleteCancel,
  onDeleteConfirm,
  onDeleteRequest,
  onEdit,
  onEditCancel,
}: {
  category: Category
  confirmingDelete: boolean
  deleting: boolean
  isLast: boolean
  isEditing: boolean
  onDeleteCancel: () => void
  onDeleteConfirm: (category: Category) => void
  onDeleteRequest: (category: Category) => void
  onEdit: (category: Category) => void
  onEditCancel: () => void
}) {
  const systemCategory = category.is_system
  const scopeLabel = category.is_system
    ? 'System category'
    : category.group_id
      ? 'Group category'
      : 'Personal category'
  if (isEditing) {
    return (
      <InlineCategoryEdit
        category={category}
        isLast={isLast}
        onCancel={onEditCancel}
      />
    )
  }

  return (
    <div
      className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2"
      style={{ borderBottom: isLast ? 'none' : '1px solid var(--app-border)' }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center p-1 text-xl leading-none"
          aria-hidden
        >
          <span className="translate-x-px" aria-hidden>
            {displayEmoji(category)}
          </span>
        </span>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate font-medium">{category.name}</p>
          </div>
          <p className="truncate text-xs" style={{ color: 'var(--app-text-muted)' }}>
            {scopeLabel}
          </p>
        </div>
      </div>
      <div className="flex justify-end gap-1.5">
        {systemCategory ? (
          <span
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-medium"
            style={{
              color: 'var(--app-text-muted)',
              background: 'var(--app-input-bg)',
              border: '1px solid var(--app-input-border)',
            }}
          >
            <Lock size={13} aria-hidden />
            System
          </span>
        ) : (
          <>
            {confirmingDelete ? (
              <>
                <button
                  type="button"
                  className="app-icon-button"
                  disabled={deleting}
                  onClick={onDeleteCancel}
                  aria-label={`Cancel deleting ${category.name}`}
                  title="Cancel"
                >
                  <X size={16} aria-hidden />
                </button>
                <button
                  type="button"
                  className="app-icon-button"
                  disabled={deleting}
                  onClick={() => onDeleteConfirm(category)}
                  aria-label={`Confirm delete ${category.name}`}
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
                  onClick={() => onEdit(category)}
                  aria-label={`Edit ${category.name}`}
                  title="Edit category"
                >
                  <Pencil size={16} aria-hidden />
                </button>
                <button
                  type="button"
                  className="app-icon-button"
                  onClick={() => onDeleteRequest(category)}
                  aria-label={`Delete ${category.name}`}
                  title="Delete category"
                >
                  <Trash2 size={16} aria-hidden />
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function InlineCategoryEdit({
  category,
  isLast,
  onCancel,
}: {
  category: Category
  isLast: boolean
  onCancel: () => void
}) {
  const updateCategory = useUpdateCategory()
  const [form, setForm] = useState({
    name: category.name,
    icon: editableEmoji(category.icon),
  })
  const [formError, setFormError] = useState<string | null>(null)

  const setField = (field: 'name' | 'icon', value: string) => {
    setForm((current) => ({ ...current, [field]: value }))
    setFormError(null)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (updateCategory.isPending) return

    const name = form.name.trim()
    if (!name) {
      setFormError('Name is required.')
      return
    }
    if (name === category.name && form.icon === editableEmoji(category.icon)) {
      onCancel()
      return
    }

    updateCategory.mutate(
      {
        categoryId: category.id,
        payload: {
          name,
          icon: form.icon,
        },
      },
      {
        onSuccess: onCancel,
        onError: (error) => {
          setFormError(error instanceof Error ? error.message : 'Failed to update category.')
        },
      },
    )
  }

  return (
    <form
      className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 py-2"
      style={{ borderBottom: isLast ? 'none' : '1px solid var(--app-border)' }}
      onSubmit={handleSubmit}
      noValidate
    >
      <div className="flex min-w-0 items-start gap-3">
        <CategoryIconSelector
          value={form.icon}
          categoryName={category.name}
          onChange={(icon) => setField('icon', icon)}
        />
        <div className="min-w-0 flex-1">
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
              aria-label={`${category.name} name`}
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
        </div>
      </div>
      <div className="flex justify-end gap-1.5">
        <button
          type="submit"
          className="app-icon-button"
          disabled={updateCategory.isPending}
          aria-label={`Save ${category.name}`}
          title="Save"
        >
          {updateCategory.isPending ? <div className="app-spinner" aria-label="Saving" /> : <Check size={16} aria-hidden />}
        </button>
        <button
          type="button"
          className="app-icon-button"
          onClick={onCancel}
          disabled={updateCategory.isPending}
          aria-label={`Cancel editing ${category.name}`}
          title="Cancel"
        >
          <X size={16} aria-hidden />
        </button>
      </div>
    </form>
  )
}

function CategoryIconSelector({
  buttonClassName = 'group flex h-9 w-9 items-center justify-center rounded-md border p-1 text-xl leading-none transition-colors duration-150 hover:border-[var(--app-border-strong)] focus-visible:border-[var(--app-accent-border)] focus-visible:outline-none',
  categoryName,
  hasError = false,
  onChange,
  value,
}: {
  buttonClassName?: string
  categoryName: string
  hasError?: boolean
  onChange: (icon: string) => void
  value: string
}) {
  const [open, setOpen] = useState(false)
  const selectorRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (selectorRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  return (
    <div ref={selectorRef} className="relative shrink-0">
      <button
        type="button"
        className={buttonClassName}
        style={{
          background: hasError ? 'var(--app-negative-soft)' : 'var(--app-input-bg)',
          borderColor: hasError ? 'var(--app-negative-border)' : 'var(--app-input-border)',
        }}
        onClick={() => setOpen((current) => !current)}
        aria-label={`Select ${categoryName} icon`}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span className="translate-x-px" aria-hidden>
          {value}
        </span>
      </button>

      {open && (
        <EmojiMartIconPicker
          categoryName={categoryName}
          onChange={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}

function EmojiMartIconPicker({
  categoryName,
  onChange,
  onClose,
}: {
  categoryName: string
  onChange: (icon: string) => void
  onClose: () => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [data, setData] = useState<EmojiMartData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const isDark = useAppDarkMode()

  useEffect(() => {
    let cancelled = false
    loadEmojiMartData()
      .then((loadedData) => {
        if (!cancelled) setData(loadedData)
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Failed to load emoji picker.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !data) return

    container.innerHTML = ''
    const picker = new Picker({
      data,
      autoFocus: true,
      emojiButtonColors: ['var(--app-accent-soft)'],
      emojiButtonRadius: '6px',
      emojiButtonSize: 32,
      emojiSize: 20,
      emojiVersion: 14,
      icons: 'outline',
      maxFrequentRows: 0,
      navPosition: 'none',
      noCountryFlags: true,
      onEmojiSelect: (selection: EmojiMartSelection) => {
        if (!selection.native) return
        onChange(selection.native)
        onClose()
      },
      perLine: 7,
      previewPosition: 'none',
      searchPosition: 'sticky',
      set: 'native',
      skinTonePosition: 'none',
      theme: isDark ? 'dark' : 'light',
    })
    const pickerElement = picker as unknown as HTMLElement
    const theme = EMOJI_MART_THEME[isDark ? 'dark' : 'light']
    pickerElement.style.setProperty('--font-family', '"DM Sans", system-ui, sans-serif')
    pickerElement.style.setProperty('--font-size', '14px')
    pickerElement.style.setProperty('--border-radius', '0.75rem')
    pickerElement.style.setProperty('--shadow', 'none')
    pickerElement.style.setProperty('--sidebar-width', '8px')
    pickerElement.style.setProperty('--rgb-color', theme.color)
    pickerElement.style.setProperty('--rgb-accent', theme.accent)
    pickerElement.style.setProperty('--rgb-background', theme.background)
    pickerElement.style.setProperty('--rgb-input', theme.input)
    pickerElement.style.setProperty('--color-border', theme.border)
    pickerElement.style.setProperty('--color-border-over', theme.borderOver)
    pickerElement.style.height = '21rem'
    container.appendChild(pickerElement)

    return () => {
      pickerElement.remove()
      container.innerHTML = ''
    }
  }, [data, isDark, onChange, onClose])

  return (
    <div
      className="absolute left-0 top-10 z-20 inline-block rounded-xl pb-2 pl-1 pr-1 pt-1"
      role="dialog"
      aria-label={`Select ${categoryName} icon`}
      style={{
        background: isDark ? 'rgb(15, 14, 12)' : 'rgb(242, 237, 228)',
        border: '1px solid var(--app-border-strong)',
        boxShadow: 'var(--app-shadow-soft)',
      }}
    >
      {loadError ? (
        <p className="w-48 p-2 text-sm" style={{ color: 'var(--app-negative)' }}>
          {loadError}
        </p>
      ) : !data ? (
        <div className="flex h-20 w-48 items-center justify-center">
          <div className="app-spinner" aria-label="Loading emoji picker" />
        </div>
      ) : (
        <div ref={containerRef} />
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 block">
      <span className="app-label mb-1.5 block">{label}</span>
      {children}
    </div>
  )
}

function SectionHeader({ title, description }: { title: string; description: React.ReactNode }) {
  return (
    <div className="app-section-header">
      <h2 className="app-section-title">{title}</h2>
      <div className="app-section-description space-y-2">
        {typeof description === 'string' ? <p>{description}</p> : description}
      </div>
    </div>
  )
}

function SettingsCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-card">
      {children}
    </div>
  )
}
