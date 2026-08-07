import { useState } from 'react'
import { Plus } from 'lucide-react'
import { ApiError } from '@/api/auth'
import { GlassSearchField } from '@/components/list-controls/GlassSearchField'
import {
  useCategories,
  useDeleteCategory,
  useForgetCategory,
  useMergeCategory,
  type Category,
} from '@/api/categories'
import CreateCategoryModal from '@/components/reference-modals/CreateCategoryModal'
import LoadingRegion from '@/components/loading/Region'
import CategorySettingsGroup from '@/pages/settings/components/category-settings-section/list/Group'
import MergeDeleteCategoryModal from '@/pages/settings/components/category-settings-section/modals/MergeDeleteModal'
import { DELETE_SPINNER_MS } from '@/pages/settings/components/category-settings-section/constants'
import { useCategorySettingsGroups } from '@/pages/settings/components/category-settings-section/hooks/useGroups'
import SettingsSectionHeader from '@/pages/settings/components/SectionHeader'
import SettingsCard from '@/pages/settings/components/Card'
import { SETTINGS_LIST_LOADING_OVERLAY_CLASS } from '@/pages/settings/components/shared/constants'
import { waitForMilliseconds } from '@/utils/timing'

/**
 * Categories pane where the user searches the category list, creates categories, and renames
 * or deletes the ones that are not built in
 *
 * A category still attached to transactions cannot be deleted outright, so a refusal from the
 * backend swaps the confirmation for the merge modal and the user picks where those
 * transactions should move instead
 */
export default function CategorySettingsSection() {
  const { data: categories = [], isLoading } = useCategories()
  const deleteCategory = useDeleteCategory()
  const forgetCategory = useForgetCategory()
  const mergeCategory = useMergeCategory()
  const [search, setSearch] = useState('')
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createModalKey, setCreateModalKey] = useState(0)
  const [confirmingDeleteCategoryId, setConfirmingDeleteCategoryId] = useState<string | null>(null)
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null)
  const [mergeDeleteCategory, setMergeDeleteCategory] = useState<Category | null>(null)
  // Held apart from the item so the panel keeps its contents while it animates out
  const [isCategoryMergeDeleteOpen, setIsCategoryMergeDeleteOpen] = useState(false)
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
      waitForMilliseconds(DELETE_SPINNER_MS),
    ])

    if (deleteResult[0].status === 'fulfilled') {
      forgetCategory(category.id)
      setConfirmingDeleteCategoryId(null)
    } else {
      const error = deleteResult[0].reason
      if (error instanceof ApiError && error.status === 409) {
        setConfirmingDeleteCategoryId(null)
        setMergeDeleteCategory(category)
        setIsCategoryMergeDeleteOpen(true)
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
      <SettingsSectionHeader
        title="Categories"
        description="Review system categories and manage custom categories."
      />

      <SettingsCard>
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <GlassSearchField
              value={search}
              onValueChange={setSearch}
              placeholder="Search categories..."
              wrapperClassName="flex-1"
              disabled={categories.length === 0}
            />
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

          {/* No transition key, since the search filters categories already in hand and blurring
              the list would hide the rows the reader is typing to find */}
          <LoadingRegion
            loading={isLoading}
            label="Loading categories"
            overlayClassName={SETTINGS_LIST_LOADING_OVERLAY_CLASS}
            animateLoadingHeight
          >
            {categories.length === 0 ? (
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
                    <CategorySettingsGroup
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
          </LoadingRegion>
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
          open={isCategoryMergeDeleteOpen}
          category={mergeDeleteCategory}
          categories={categories}
          isPending={mergeCategory.isPending}
          onClose={() => setIsCategoryMergeDeleteOpen(false)}
          onExitComplete={() => setMergeDeleteCategory(null)}
          onMerge={async (replacementCategoryId) => {
            await mergeCategory.mutateAsync({
              categoryId: mergeDeleteCategory.id,
              payload: { replacement_category_id: replacementCategoryId },
            })
          }}
        />
      )}
    </section>
  )
}
