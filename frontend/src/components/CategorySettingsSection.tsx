import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, Lock, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { ApiError } from '@/api/auth'
import {
  useCategories,
  useDeleteCategory,
  useMergeCategory,
  useUpdateCategory,
  type Category,
} from '@/api/categories'
import { categoryKeys } from '@/api/queryKeys'
import CreateCategoryModal, { CategoryIconSelector } from '@/components/CreateCategoryModal'
import Dropdown from '@/components/Dropdown'

type CategoryKind = Category['kind']

const KIND_LABELS: Record<CategoryKind, string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
}

const KIND_ORDER: CategoryKind[] = ['expense', 'income', 'transfer']
const DEFAULT_CATEGORY_ICON = '🏷️'
const DELETE_SPINNER_MS = 1000

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
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

export default function CategorySettingsSection() {
  const queryClient = useQueryClient()
  const { data: categories = [], isLoading } = useCategories()
  const deleteCategory = useDeleteCategory()
  const mergeCategory = useMergeCategory()
  const [search, setSearch] = useState('')
  const [expandedKinds, setExpandedKinds] = useState<Set<CategoryKind>>(() => new Set())
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createModalKey, setCreateModalKey] = useState(0)
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
              onClick={() => {
                setCreateModalKey((key) => key + 1)
                setShowCreateModal(true)
              }}
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

      <CreateCategoryModal
        key={createModalKey}
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={handleCreated}
      />
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
