import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { GlassSearchField } from '@/components/list-controls/GlassSearchField'
import LoadingRegion from '@/components/loading/Region'
import { ApiError } from '@/api/auth'
import {
  useDeleteTag,
  useForgetTag,
  useMergeTag,
  type Tag,
} from '@/api/tags'
import SettingsSectionHeader from '@/pages/settings/components/SectionHeader'
import SettingsCard from '@/pages/settings/components/Card'
import MergeDeleteTagModal from '@/pages/settings/components/tag-settings-section/modals/MergeDeleteModal'
import TagCreateModal from '@/pages/settings/components/tag-settings-section/modals/CreateModal'
import TagSettingsList from '@/pages/settings/components/tag-settings-section/list/List'
import { DELETE_SPINNER_MS } from '@/pages/settings/components/tag-settings-section/constants'
import { SETTINGS_LIST_LOADING_OVERLAY_CLASS } from '@/pages/settings/components/shared/constants'
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
  const deleteTag = useDeleteTag()
  const forgetTag = useForgetTag()
  const mergeTag = useMergeTag()
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createModalKey, setCreateModalKey] = useState(0)
  const [editingTagId, setEditingTagId] = useState<string | null>(null)
  const [confirmingDeleteTagId, setConfirmingDeleteTagId] = useState<string | null>(null)
  const [deletingTagId, setDeletingTagId] = useState<string | null>(null)
  const [mergeDeleteTag, setMergeDeleteTag] = useState<Tag | null>(null)
  // Held apart from the item so the panel keeps its contents while it animates out
  const [isTagMergeDeleteOpen, setIsTagMergeDeleteOpen] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [locallyDeletedTagIds, setLocallyDeletedTagIds] = useState<string[]>([])
  const tagList = useTagSettingsList(locallyDeletedTagIds)
  // The rows and everything describing how they are laid out are held together, since a search
  // empties the live list the moment it settles while the rows on screen are still the old ones.
  // A list keeping its rows but losing its scroll cap would grow to the full height of them
  const tagListSnapshot = useMemo(() => ({
    hasMore: tagList.hasMoreTags,
    shouldScroll: tagList.shouldScrollTags,
    showListEnd: tagList.showTagListEnd,
    showListMoreIndicator: tagList.showTagListMoreIndicator,
    tags: tagList.visibleTags,
  }), [
    tagList.hasMoreTags,
    tagList.shouldScrollTags,
    tagList.showTagListEnd,
    tagList.showTagListMoreIndicator,
    tagList.visibleTags,
  ])

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
      forgetTag(tag.id)
      setConfirmingDeleteTagId(null)
    } else {
      const error = deleteResult[0].reason
      if (error instanceof ApiError && error.status === 409) {
        setConfirmingDeleteTagId(null)
        setMergeDeleteTag(tag)
        setIsTagMergeDeleteOpen(true)
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

          {/* Outside the list rather than inside it, since the list clips its own box while
              animating its height and would cut the spinner off part way through a load. That
              same animation is what moves the box as the rows change, so the region is not asked
              to hold a height here */}
          <LoadingRegion
            loading={tagList.showInitialTagLoading}
            label="Loading tags"
            transitionKey={tagList.activeSearch}
            snapshot={tagListSnapshot}
            overlayClassName={SETTINGS_LIST_LOADING_OVERLAY_CLASS}
          >
            {(shownTags) => (
              <TagSettingsList
                activeSearch={tagList.activeSearch}
                confirmingDeleteTagId={confirmingDeleteTagId}
                deletingTagId={deletingTagId}
                editingTagId={editingTagId}
                hasMoreTags={shownTags.hasMore}
                listError={tagList.tagListError}
                listFailed={tagList.tagListFailed}
                showFetchingMoreTags={tagList.showFetchingMoreTags}
                showInitialTagLoading={tagList.showInitialTagLoading}
                showTagListEnd={shownTags.showListEnd}
                showTagListMoreIndicator={shownTags.showListMoreIndicator}
                shouldScrollTags={shownTags.shouldScroll}
                tagListRef={tagList.tagListRef}
                visibleTags={shownTags.tags}
                onDeleteCancel={handleDeleteCancel}
                onDeleteConfirm={handleDelete}
                onDeleteRequest={handleDeleteRequest}
                onEdit={(tag) => setEditingTagId(tag.id)}
                onEditCancel={() => setEditingTagId(null)}
                onListMoreClick={tagList.handleTagListMoreClick}
                onListScroll={tagList.handleTagListScroll}
              />
            )}
          </LoadingRegion>
        </div>
      </SettingsCard>

      <TagCreateModal
        key={createModalKey}
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={() => setShowCreateModal(false)}
      />
      {mergeDeleteTag && (
        <MergeDeleteTagModal
          open={isTagMergeDeleteOpen}
          key={mergeDeleteTag.id}
          tag={mergeDeleteTag}
          isPending={mergeTag.isPending}
          onClose={() => setIsTagMergeDeleteOpen(false)}
          onExitComplete={() => setMergeDeleteTag(null)}
          onMerge={async (replacementTagId) => {
            await mergeTag.mutateAsync({
              tagId: mergeDeleteTag.id,
              payload: { replacement_tag_id: replacementTagId },
            })
          }}
        />
      )}
    </section>
  )
}
