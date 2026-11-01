export interface Tag {
  id: string
  owner_id: string
  group_id: string | null
  name: string
  created_at: string
}

export interface TagNameMatch {
  /** The tag name exactly as it was asked about, so the answer reads back against what was sent */
  source: string
  tag: Tag
}

export interface TagFilters {
  group_id?: string
  q?: string
}

export interface CreateTagPayload {
  name: string
  group_id?: string | null
}

export interface UpdateTagPayload {
  name?: string
}

export interface MergeTagPayload {
  replacement_tag_id: string
}

export interface UpdateTagRequest {
  tagId: string
  payload: UpdateTagPayload
}

export interface MergeTagRequest {
  tagId: string
  payload: MergeTagPayload
}
