export type {
  CreateTagPayload,
  MergeTagPayload,
  MergeTagRequest,
  Tag,
  TagFilters,
  UpdateTagPayload,
  UpdateTagRequest,
} from '@/api/tags/types';

export {
  createTag,
  deleteTag,
  fetchTag,
  fetchTagsPage,
  mergeTag,
  updateTag,
} from '@/api/tags/requests';

export {
  useCreateTag,
  useDeleteTag,
  useInfiniteTags,
  useMergeTag,
  useTag,
  useUpdateTag,
} from '@/api/tags/hooks';
