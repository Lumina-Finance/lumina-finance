import { useMemo, useState } from 'react'
import { ChevronDown, Lock, Search, Trash2 } from 'lucide-react'
import { useCategories, useDeleteCategory, type Category } from '@/api/categories'

type CategoryKind = Category['kind']

const KIND_LABELS: Record<CategoryKind, string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
}

const KIND_ORDER: CategoryKind[] = ['expense', 'income', 'transfer']

const PROTECTED_CATEGORY_NAMES = new Set(['Transfer', 'Credit Card Payment', 'Debt Payment', 'Vehicle Maintenance'])

function isProtectedCategory(category: Pick<Category, 'name'>): boolean {
  return PROTECTED_CATEGORY_NAMES.has(category.name)
}

function displayEmoji(category: Category): string {
  return category.icon ?? '🏷️'
}

function displayKind(category: Category): CategoryKind {
  return category.name === 'Debt Payment' ? 'expense' : category.kind
}

export default function CategorySettingsSection() {
  const { data: categories = [], isLoading } = useCategories()
  const deleteCategory = useDeleteCategory()
  const [search, setSearch] = useState('')
  const [expandedKinds, setExpandedKinds] = useState<Set<CategoryKind>>(() => new Set())
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
    if (isProtectedCategory(category)) return
    const confirmed = window.confirm(`Delete ${category.name}? This cannot be undone.`)
    if (!confirmed) return
    setDeleteError(null)
    deleteCategory.mutate(category.id, {
      onError: (error) => {
        setDeleteError(error instanceof Error ? error.message : 'Failed to delete category.')
      },
    })
  }

  return (
    <section id="categories" className="scroll-mt-8">
      <SectionHeader
        title="Categories"
        description="Review categories and remove unused non-required categories."
      />

      <SettingsCard>
        <div className="space-y-4">
          <div className="relative min-w-0">
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
                    onDelete={handleDelete}
                    onToggle={() => toggleKind(kind)}
                  />
                )
              ))}
            </div>
          )}
        </div>
      </SettingsCard>
    </section>
  )
}

function CategoryGroup({
  categories,
  deletingCategoryId,
  expanded,
  kind,
  onDelete,
  onToggle,
}: {
  categories: Category[]
  deletingCategoryId: string | null | undefined
  expanded: boolean
  kind: CategoryKind
  onDelete: (category: Category) => void
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
              onDelete={onDelete}
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
  onDelete,
}: {
  category: Category
  deleting: boolean
  isLast: boolean
  onDelete: (category: Category) => void
}) {
  const protectedCategory = isProtectedCategory(category)

  return (
    <div
      className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2"
      style={{ borderBottom: isLast ? 'none' : '1px solid var(--app-border)' }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="flex h-9 w-8 shrink-0 items-center justify-center text-xl"
          aria-hidden
        >
          {displayEmoji(category)}
        </span>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate font-medium">{category.name}</p>
          </div>
          <p className="truncate text-xs" style={{ color: 'var(--app-text-muted)' }}>
            {category.group_id ? 'Group category' : 'Personal category'}
          </p>
        </div>
      </div>
      <div className="flex justify-end gap-1.5">
        {protectedCategory ? (
          <span
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-medium"
            style={{
              color: 'var(--app-text-muted)',
              background: 'var(--app-input-bg)',
              border: '1px solid var(--app-input-border)',
            }}
          >
            <Lock size={13} aria-hidden />
            Required
          </span>
        ) : (
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
        )}
      </div>
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
