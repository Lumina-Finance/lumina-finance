import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence } from 'motion/react'
import { Plus, Search } from 'lucide-react'
import { ApiError } from '@/api/auth'
import {
  useCategories,
  useDeleteCategory,
  useMergeCategory,
  type Category,
} from '@/api/categories'
import { categoryKeys } from '@/api/queryKeys'
import CreateCategoryModal from '@/components/CreateCategoryModal'
import CategoryGroup from '@/settings/components/CategorySettingsSection/CategoryGroup'
import MergeDeleteCategoryModal from '@/settings/components/CategorySettingsSection/MergeDeleteCategoryModal'
import { DELETE_SPINNER_MS } from '@/settings/components/CategorySettingsSection/categorySettingsConstants'
import { delay } from '@/settings/components/CategorySettingsSection/categorySettingsUtils'
import { useCategorySettingsGroups } from '@/settings/components/CategorySettingsSection/hooks/useCategorySettingsGroups'
import SectionHeader from '@/settings/components/SectionHeader'
import SettingsCard from '@/settings/components/SettingsCard'

export default function CategorySettingsSection() {
  const queryClient = useQueryClient()
  const { data: categories = [], isLoading } = useCategories()
  const deleteCategory = useDeleteCategory()
  const mergeCategory = useMergeCategory()
  const [search, setSearch] = useState('')
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createModalKey, setCreateModalKey] = useState(0)
  const [confirmingDeleteCategoryId, setConfirmingDeleteCategoryId] = useState<string | null>(null)
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null)
  const [mergeDeleteCategory, setMergeDeleteCategory] = useState<Category | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const {
    expandedKinds,
    expandKind,
    groupedCategories,
    hasMatches,
    toggleKind,
  } = useCategorySettingsGroups(categories, search)

  const handleDeleteRequest = (category: Category) => {
    setDeleteError(null)
    setEditingCategoryId(null)
    setConfirmingDeleteCategoryId(category.id)
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
    expandKind(category.kind)
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
                    onDeleteRequest={handleDeleteRequest}
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
      <AnimatePresence>
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
            }}
          />
        )}
      </AnimatePresence>
    </section>
  )
}
