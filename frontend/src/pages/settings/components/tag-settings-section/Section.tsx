import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence } from 'motion/react'
import { Plus } from 'lucide-react'
import { GlassSearchField } from '@/components/list-controls/GlassSearchField'
import { ApiError } from '@/api/auth'
import { tagKeys } from '@/api/cache/queryKeys'
import {
  useDeleteTag,
  useMergeTag,
  type Tag,
} from '@/api/tags'
import SettingsSectionHeader from '@/pages/settings/components/SectionHeader'
import SettingsCard from '@/pages/settings/components/Card'
import MergeDeleteTagModal from '@/pages/settings/components/tag-settings-section/modals/MergeDeleteModal'
import TagCreateModal from '@/pages/settings/components/tag-settings-section/modals/CreateModal'
import TagSettingsList from '@/pages/settings/components/tag-settings-section/list/List'
import { DELETE_SPINNER_MS } from '@/pages/settings/components/tag-settings-section/constants'
import { useTagSettingsList } from '@/pages/settings/components/tag-settings-section/hooks/useList'
import { waitForMilliseconds } from '@/utils/timing'

/**
 * Settings section for managing tags, combining search, creation, inline editing and deletion
 * with the list of tag rows
 *
 * A delete the backend rejects with a 409 conflict, meaning the tag is still applied to
 * transactions, reopens as a merge instead of failing outright, prompting the user to pick a
 * replacement tag
 */
export default function TagSettingsSection() {
  const queryClient = useQueryClient()
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
  const tagList = useTagSettingsList(locallyDeletedTagIds)

  const handleDeleteCancel = () => setConfirmingDeleteTagId(null)

  const handleDeleteRequest = (tag: Tag) => {
    setDeleteError(null)
    setEditingTagId(null)
    setConfirmingDeleteTagId(tag.id)
  }

  const handleDelete = async (tag: Tag) => {
    setDeleteError(null)
    setDeletingTagId(tag.id)

    const deleteResult = await Promise.allSettled([
      deleteTag.mutateAsync(tag.id),
      waitForMilliseconds(DELETE_SPINNER_MS),
    ])

    if (deleteResult[0].status === 'fulfilled') {
      setLocallyDeletedTagIds((ids) => ids.includes(tag.id) ? ids : [...ids, tag.id])
      tagList.setVisibleTags((tags) => tags.filter((item) => item.id !== tag.id))
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
      <SettingsSectionHeader
        title="Tags"
        description="Manage reusable labels for transaction organization."
      />

      <SettingsCard>
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <GlassSearchField
              value={tagList.search}
              onValueChange={tagList.setSearch}
              onSubmit={() => tagList.setActiveSearch(tagList.search)}
              placeholder="Search tags..."
              wrapperClassName="flex-1"
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
              Create tag
            </button>
          </div>

          {deleteError && (
            <p className="text-sm" style={{ color: 'var(--app-negative)' }}>
              {deleteError}
            </p>
          )}

          <TagSettingsList
            activeSearch={tagList.activeSearch}
            confirmingDeleteTagId={confirmingDeleteTagId}
            deletingTagId={deletingTagId}
            editingTagId={editingTagId}
            hasMoreTags={tagList.hasMoreTags}
            showFetchingMoreTags={tagList.showFetchingMoreTags}
            showInitialTagLoading={tagList.showInitialTagLoading}
            showTagListEnd={tagList.showTagListEnd}
            showTagListMoreIndicator={tagList.showTagListMoreIndicator}
            shouldScrollTags={tagList.shouldScrollTags}
            tagListRef={tagList.tagListRef}
            visibleTags={tagList.visibleTags}
            onDeleteCancel={handleDeleteCancel}
            onDeleteConfirm={handleDelete}
            onDeleteRequest={handleDeleteRequest}
            onEdit={(tag) => setEditingTagId(tag.id)}
            onEditCancel={() => setEditingTagId(null)}
            onListMoreClick={tagList.handleTagListMoreClick}
            onListScroll={tagList.handleTagListScroll}
          />
        </div>
      </SettingsCard>

      <TagCreateModal
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
