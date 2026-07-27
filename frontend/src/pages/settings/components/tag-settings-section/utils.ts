import type { Tag } from '@/api/tags'
import type { DropdownOption } from '@/components/dropdown/Dropdown'

/**
 * Label for whether a tag is shared with a group or belongs to the current user alone
 */
export function scopeLabel(tag: Tag) {
  return tag.group_id ? 'Group' : 'Personal'
}

/**
 * Tags offered as the destination when merging one tag away, labelled by whether each is
 * shared with a group or personal
 *
 * Only tags in the same group as the one being replaced qualify, or only personal tags when the
 * original has no group, so a merge never crosses ownership
 */
export function tagMergeOptions(tag: Tag, tags: Tag[]): DropdownOption[] {
  return tags
    .filter((option) => {
      if (option.id === tag.id) return false
      return tag.group_id
        ? option.group_id === tag.group_id
        : option.group_id === null
    })
    .map((option) => ({
      value: option.id,
      label: option.name,
      group: option.group_id ? 'Group' : 'Personal',
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
}
