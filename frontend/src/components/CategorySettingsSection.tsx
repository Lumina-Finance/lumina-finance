import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Picker } from 'emoji-mart'
import { Check, ChevronDown, Lock, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import {
  useCategories,
  useCreateCategory,
  useDeleteCategory,
  useUpdateCategory,
  type Category,
} from '@/api/categories'
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

interface EmojiMartData {
  emojis?: Record<string, unknown>
}

interface EmojiMartSelection {
  native?: string
}

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
  const { data: categories = [], isLoading } = useCategories()
  const deleteCategory = useDeleteCategory()
  const [search, setSearch] = useState('')
  const [expandedKinds, setExpandedKinds] = useState<Set<CategoryKind>>(() => new Set())
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
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
  const handleDelete = (category: Category) => {
    if (category.is_system) return
    const confirmed = window.confirm(`Delete ${category.name}? This cannot be undone.`)
    if (!confirmed) return
    setDeleteError(null)
    deleteCategory.mutate(category.id, {
      onError: (error) => {
        setDeleteError(error instanceof Error ? error.message : 'Failed to delete category.')
      },
    })
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

          {isLoading ? (
            <div className="h-24 rounded-lg bg-gray-300" />
          ) : categories.length === 0 ? (
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
                    deletingCategoryId={deleteCategory.isPending ? deleteCategory.variables : null}
                    editingCategoryId={editingCategoryId}
                    onDelete={handleDelete}
                    onEdit={(category) => setEditingCategoryId(category.id)}
                    onEditCancel={() => setEditingCategoryId(null)}
                    onToggle={() => toggleKind(kind)}
                  />
                )
              ))}
            </div>
          )}
        </div>
      </SettingsCard>

      {showCreateModal && (
        <CreateCategoryModal
          onClose={() => setShowCreateModal(false)}
          onCreated={handleCreated}
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
    icon: DEFAULT_CATEGORY_ICON,
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

  const setField = <K extends keyof typeof form>(field: K, value: (typeof form)[K]) => {
    setForm((current) => ({ ...current, [field]: value }))
    setFormError(null)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (createCategory.isPending) return

    const name = form.name.trim()
    if (!name) {
      setFormError('Name is required.')
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

  return (
    <>
      <div
        className="fixed inset-0 z-50"
        style={{ background: 'rgba(0, 0, 0, 0.35)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
        aria-hidden
      />

      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-category-title"
          className="w-full max-w-lg rounded-2xl p-6 sm:p-8"
          style={{
            background: 'var(--app-bg)',
            border: '1px solid var(--app-border-strong)',
            boxShadow: 'var(--app-shadow-soft)',
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <form className="space-y-6" onSubmit={handleSubmit} noValidate>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="create-category-title" className="font-serif text-2xl font-light tracking-tight">
                  Create category
                </h3>
                <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                  Add a personal category for transactions and budgets.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="app-icon-button shrink-0"
                aria-label="Close"
              >
                <X size={18} aria-hidden />
              </button>
            </div>

            <div className="grid gap-x-4 gap-y-3 sm:grid-cols-[auto_minmax(0,1fr)]">
              <span className="app-label block">Icon</span>
              <span className="app-label block">Category name</span>
              <div>
                <CategoryIconSelector
                  categoryName={form.name || 'New category'}
                  value={form.icon}
                  onChange={(icon) => setField('icon', icon)}
                  buttonClassName="app-input flex h-10 w-10 items-center justify-center p-0 text-xl leading-none"
                />
              </div>
              <div>
                <input
                  className="app-input"
                  value={form.name}
                  onChange={(event) => setField('name', event.target.value)}
                  placeholder="Groceries"
                  maxLength={256}
                  required
                />
              </div>
              <div className="sm:col-span-2">
                <Field label="Category type">
                  <Dropdown
                    options={KIND_OPTIONS}
                    value={form.kind}
                    onChange={(value) => setField('kind', value as CategoryKind)}
                  />
                </Field>
              </div>
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
              {formError && (
                <p className="text-sm sm:mr-auto" style={{ color: 'var(--app-negative)' }}>
                  {formError}
                </p>
              )}
              <button type="button" className="app-secondary-button" onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                className="app-primary-button inline-flex items-center justify-center gap-2"
                disabled={createCategory.isPending}
              >
                {createCategory.isPending ? <div className="app-spinner" aria-label="Creating" /> : <Plus size={16} aria-hidden />}
                Create category
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
  deletingCategoryId,
  editingCategoryId,
  expanded,
  kind,
  onDelete,
  onEdit,
  onEditCancel,
  onToggle,
}: {
  categories: Category[]
  deletingCategoryId: string | null | undefined
  editingCategoryId: string | null
  expanded: boolean
  kind: CategoryKind
  onDelete: (category: Category) => void
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
              deleting={deletingCategoryId === category.id}
              isLast={index === categories.length - 1}
              isEditing={editingCategoryId === category.id}
              onDelete={onDelete}
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
  deleting,
  isLast,
  isEditing,
  onDelete,
  onEdit,
  onEditCancel,
}: {
  category: Category
  deleting: boolean
  isLast: boolean
  isEditing: boolean
  onDelete: (category: Category) => void
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
              disabled={deleting}
              onClick={() => onDelete(category)}
              aria-label={`Delete ${category.name}`}
              title="Delete category"
            >
              {deleting ? <div className="app-spinner" aria-label="Deleting" /> : <Trash2 size={16} aria-hidden />}
            </button>
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
  onChange,
  value,
}: {
  buttonClassName?: string
  categoryName: string
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
          background: 'var(--app-input-bg)',
          borderColor: 'var(--app-input-border)',
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
    <div className="mb-4">
      <h2
        className="font-serif font-medium tracking-tight"
        style={{ fontSize: 'clamp(1.5rem, 2.2vw, 2rem)', lineHeight: 1.1 }}
      >
        {title}
      </h2>
      <div className="mt-1 space-y-2 text-base" style={{ color: 'var(--app-text-muted)' }}>
        {typeof description === 'string' ? <p>{description}</p> : description}
      </div>
    </div>
  )
}

function SettingsCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-2xl p-5 sm:p-6"
      style={{
        background: 'var(--app-surface-soft)',
        border: '1px solid var(--app-border)',
      }}
    >
      {children}
    </div>
  )
}
