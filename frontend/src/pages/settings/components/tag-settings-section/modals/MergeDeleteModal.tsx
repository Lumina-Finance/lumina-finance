import { useMemo } from 'react'
import { Tag as TagIcon } from 'lucide-react'
import { useInfiniteTags, type Tag } from '@/api/tags'
import MergeDeleteReferenceModal from '@/pages/settings/components/shared/modals/MergeDeleteReferenceModal'
import {
  DELETE_SPINNER_MS,
  TAG_MERGE_PAGE_SIZE,
} from '@/pages/settings/components/tag-settings-section/constants'
import { tagMergeOptions } from '@/pages/settings/components/tag-settings-section/utils'

/**
 * Resolves the tags offered as a replacement, querying the same group as the tag being
 * replaced and paging in more matches as the user scrolls or searches
 */
function useTagReplacementQuery(tag: Tag, search: string) {
  const query = useInfiniteTags(
    { group_id: tag.group_id ?? undefined, q: search.trim() || undefined },
    TAG_MERGE_PAGE_SIZE,
  )
  const replacements = useMemo(() => query.data?.pages.flat() ?? [], [query.data])

  return {
    replacements,
    isLoading: query.isLoading,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: !!query.hasNextPage,
    fetchNextPage: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage()
    },
  }
}

/**
 * Modal shown when a tag cannot be deleted because transactions still carry it, asking which
 * tag those transactions should move to before the original is removed
 *
 * The replacement options only offer tags sharing the same group as the one being deleted
 */
export default function MergeDeleteTagModal({
  open,
  tag,
  isPending,
  onClose,
  onExitComplete,
  onMerge,
}: {
  open: boolean
  tag: Tag
  isPending: boolean
  onClose: () => void
  onExitComplete: () => void
  onMerge: (replacementTagId: string) => Promise<void>
}) {
  return (
    <MergeDeleteReferenceModal
      open={open}
      item={tag}
      isPending={isPending}
      submitMinVisibleMs={DELETE_SPINNER_MS}
      filterOptionsLocally={false}
      icon={TagIcon}
      buildOptions={tagMergeOptions}
      useReplacementQuery={useTagReplacementQuery}
      wording={{
        entityLabel: 'Tag',
        fieldLabel: 'Replacement Tag',
        description: `${tag.name} is used by existing transactions. Choose another tag for those transactions, then it can be deleted.`,
        selectSrLabel: 'Replacement tag',
        searchPlaceholder: 'Search tags...',
        selectPlaceholder: 'Select tag...',
        emptyOptionsPlaceholder: 'No compatible tags',
        loadingPlaceholder: 'Loading tags...',
        requireSelectionError: 'Select a replacement tag.',
        deleteErrorFallback: 'Failed to delete tag.',
      }}
      onClose={onClose}
      onExitComplete={onExitComplete}
      onMerge={onMerge}
    />
  )
}
