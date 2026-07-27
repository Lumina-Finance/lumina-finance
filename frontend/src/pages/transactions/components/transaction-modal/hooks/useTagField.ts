import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { useInfiniteTags, type Tag } from '@/api/tags'
import type { TransactionTag } from '@/api/transactions'
import {
  TAG_DROPDOWN_PAGE_SIZE,
  TAG_FETCHING_MORE_TEXT_MIN_MS,
  TAG_SEARCH_DEBOUNCE_MS,
  TAG_SEARCH_LOADING_TEXT_MIN_MS,
} from '@/pages/transactions/components/transaction-modal/constants'
import type { TransactionFormValues } from '@/pages/transactions/components/transaction-modal/types'
import { useDebouncedReferenceSearch } from './useDebouncedReferenceSearch'
import { usePagedReferenceDropdown } from './usePagedReferenceDropdown'

interface UseTagFieldOptions {
  open: boolean
  groupId: string | null | undefined
  form: TransactionFormValues
  setForm: Dispatch<SetStateAction<TransactionFormValues>>
  transactionTags?: TransactionTag[]
  closeModal: () => void
}

interface TagFieldState {
  tagById: Map<string, Pick<Tag, 'id' | 'group_id' | 'name'>>
  tagOptions: { value: string; label: string }[]
  selectedTags: Pick<Tag, 'id' | 'group_id' | 'name'>[]
  search: string
  setSearch: (value: string) => void
  setActiveSearch: (value: string) => void
  showLoading: boolean
  loadingText: string
  showInitialLoading: boolean
  hasMore: boolean
  loadMore: () => void
  handleTagChange: (tagId: string) => void
  handleRemoveTag: (tagId: string) => void
  handleTagCreated: (tag: Tag) => void
}

/**
 * Owns tag search, pagination, selected-tag state, tag options, and inline tag creation for the
 * transaction form
 */
export function useTagField({
  open,
  groupId,
  form,
  setForm,
  transactionTags,
  closeModal,
}: UseTagFieldOptions): TagFieldState {
  const [createdTags, setCreatedTags] = useState<Tag[]>([])
  const selectedTagIds = form.tag_ids

  const tagReferenceSearch = useDebouncedReferenceSearch(TAG_SEARCH_DEBOUNCE_MS)
  const tagQuery = useInfiniteTags(
    {
      group_id: groupId ?? undefined,
      q: tagReferenceSearch.activeSearchText || undefined,
    },
    TAG_DROPDOWN_PAGE_SIZE,
    open && !!form.account_id,
  )
  const tagReference = usePagedReferenceDropdown({
    query: tagQuery,
    activeSearchText: tagReferenceSearch.activeSearchText,
    searchLoadingMinMs: TAG_SEARCH_LOADING_TEXT_MIN_MS,
    fetchingMoreMinMs: TAG_FETCHING_MORE_TEXT_MIN_MS,
    idleLoadingText: 'Loading tags...',
  })

  const tagById = useMemo(() => {
    const map = new Map<string, Pick<Tag, 'id' | 'group_id' | 'name'>>()
    transactionTags?.forEach((tag) => map.set(tag.id, tag))
    tagReference.fetchedItems.forEach((tag) => map.set(tag.id, tag))
    tagReference.visibleItems.forEach((tag) => map.set(tag.id, tag))
    createdTags.forEach((tag) => map.set(tag.id, tag))
    return map
  }, [createdTags, tagReference.fetchedItems, tagReference.visibleItems, transactionTags])

  const tagCandidates = useMemo(() => {
    const map = new Map<string, Tag>()
    tagReference.visibleItems.forEach((tag) => map.set(tag.id, tag))
    createdTags.forEach((tag) => map.set(tag.id, tag))
    return [...map.values()]
  }, [createdTags, tagReference.visibleItems])

  const tagOptions = useMemo(
    () => tagCandidates
      .filter((tag) => !selectedTagIds.includes(tag.id))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((tag) => ({ value: tag.id, label: tag.name })),
    [selectedTagIds, tagCandidates],
  )

  const selectedTags = useMemo(
    () => selectedTagIds
      .map((tagId) => tagById.get(tagId))
      .filter((tag): tag is Pick<Tag, 'id' | 'group_id' | 'name'> => !!tag),
    [selectedTagIds, tagById],
  )

  const handleTagChange = (tagId: string) => {
    setForm((f) => {
      if (f.tag_ids.includes(tagId)) return f
      return { ...f, tag_ids: [...f.tag_ids, tagId] }
    })
  }

  const handleRemoveTag = (tagId: string) => {
    setForm((f) => ({ ...f, tag_ids: f.tag_ids.filter((id) => id !== tagId) }))
  }

  const handleTagCreated = (tag: Tag) => {
    setCreatedTags((tags) => [...tags.filter((item) => item.id !== tag.id), tag])
    setForm((f) => (
      f.tag_ids.includes(tag.id) ? f : { ...f, tag_ids: [...f.tag_ids, tag.id] }
    ))
    tagReferenceSearch.clearSearch()
    closeModal()
  }

  return {
    tagById,
    tagOptions,
    selectedTags,
    search: tagReferenceSearch.search,
    setSearch: tagReferenceSearch.setSearch,
    setActiveSearch: tagReferenceSearch.setActiveSearch,
    showLoading: tagReference.showLoading,
    loadingText: tagReference.loadingText,
    showInitialLoading: tagReference.showInitialLoading,
    hasMore: !!tagQuery.hasNextPage,
    loadMore: tagReference.loadMore,
    handleTagChange,
    handleRemoveTag,
    handleTagCreated,
  }
}
