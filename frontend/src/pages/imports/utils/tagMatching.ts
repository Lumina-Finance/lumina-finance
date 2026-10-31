import type { Tag } from '@/api/tags'
import type { TransactionImportTagMapping } from '@/api/transaction-imports'
import type { DropdownOption } from '@/components/dropdown/Dropdown'
import { CREATE_TAG_VALUE, SKIP_TAG_VALUE } from '@/pages/imports/constants'
import { buildImportNameMappings, getImportNameRowState } from './nameMatching'

/**
 * Builds the answers the tag step offers for one tag name
 *
 * The tags offered are the ones the file's own values already match, plus whatever a search turned
 * up, since the page never holds every tag a person has
 *
 * @param tags - Tags to offer, from the file's matches and from the current search
 * @param pickedLabelsById - What tags already picked are called, so one chosen through the search
 *   stays offerable once the search that found it is cleared
 */
export function buildImportTagOptions(tags: Tag[], pickedLabelsById: Record<string, string> = {}): DropdownOption[] {
  const labelsById = new Map(Object.entries(pickedLabelsById))
  for (const tag of tags) labelsById.set(tag.id, tag.name)

  return [
    { value: CREATE_TAG_VALUE, label: 'Create new tag', group: 'Import action' },
    { value: SKIP_TAG_VALUE, label: 'Skip', group: 'Import action' },
    ...[...labelsById.entries()]
      .sort(([, first], [, second]) => first.localeCompare(second))
      .map(([id, label]) => ({
        value: id,
        label,
        group: 'Existing tags',
      })),
  ]
}

/**
 * What one tag name resolves to once the file's matches and the user's answer are both read
 *
 * @param answer - What the user chose for it, blank where they left it alone
 * @param matched - The tag the value already matches, if any
 */
export function getImportTagRowState(answer: string, matched: Tag | undefined) {
  return getImportNameRowState(answer, Boolean(matched), CREATE_TAG_VALUE, SKIP_TAG_VALUE)
}

/**
 * Builds the tag answers the commit payload carries
 *
 * @param importedTags - One tag name per tag the file resolves to
 * @param matchedTagByKey - The tags the file's values already match
 * @param tagMappings - What the user chose for each value, blank where they left it alone
 * @param tagCreateNames - The name the user wrote for a value being created
 */
export function buildImportTagMappings({
  importedTags,
  matchedTagByKey,
  tagMappings,
  tagCreateNames,
}: {
  importedTags: string[]
  matchedTagByKey: Map<string, Tag>
  tagMappings: Record<string, string>
  tagCreateNames: Record<string, string>
}) {
  return buildImportNameMappings<Tag, TransactionImportTagMapping>({
    values: importedTags,
    matchedByKey: matchedTagByKey,
    answers: tagMappings,
    createNames: tagCreateNames,
    createValue: CREATE_TAG_VALUE,
    skipValue: SKIP_TAG_VALUE,
    noun: 'tag',
    buildChosen: (source, id) => ({ source, tag_id: id }),
  })
}
