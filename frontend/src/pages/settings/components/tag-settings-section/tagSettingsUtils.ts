import type { Tag } from '@/api/tags'
import type { DropdownOption } from '@/components/dropdown/Dropdown'

export function scopeLabel(tag: Tag) {
  return tag.group_id ? 'Group' : 'Personal'
}

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
