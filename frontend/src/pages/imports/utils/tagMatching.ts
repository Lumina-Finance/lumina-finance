import type { Tag } from '@/api/tags'
import type { TransactionImportTagMapping } from '@/api/transaction-imports'
import type { DropdownOption } from '@/components/dropdown/Dropdown'
import { getNameKey } from '@/api/shared/nameKey'
import { CREATE_TAG_VALUE, IMPORT_TAG_NAME_MAX_LENGTH, SKIP_TAG_VALUE } from '@/pages/imports/constants'
import { buildImportNameMappings, getImportNameAnswer, getImportNameRowState } from './nameMatching'

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

    // A tag is written under the capitals it is given, so Travel typed for TRAVEL is a correction
    keepsCapitalCorrections: true,
    maxNameLength: IMPORT_TAG_NAME_MAX_LENGTH,
  })
}

/**
 * Says what is wrong with the name a new tag would be created under, if anything
 *
 * @param name - The name as typed
 * @returns A short reason, or an empty string where the name can be used
 */
export function getImportTagCreateNameError(name: string) {
  const trimmed = name.trim()
  if (!trimmed) return 'Enter a name for the new tag.'
  if ([...trimmed].length > IMPORT_TAG_NAME_MAX_LENGTH) {
    return `A tag name can have at most ${IMPORT_TAG_NAME_MAX_LENGTH} characters.`
  }
  return ''
}

/**
 * Works out the tags one previewed row will carry, once the user's tag answers are read
 *
 * A skipped name is left off, a name pointed at a tag or corrected shows that tag's name, and a name
 * the file matches shows the tag it matches. Names that end up as one tag show once
 *
 * @param rowTagNames - The tag names the row states
 * @param answers - What the tag step holds
 * @param answers.importedTags - One name per tag the file resolves to, which answers are held under
 * @param answers.matchedTagByKey - The tags the file's values already match
 * @param answers.tagMappings - What the user chose for each value, blank where they left it alone
 * @param answers.tagCreateNames - The name the user wrote for a value being created
 * @param answers.tagLabelById - What each tag on offer is called
 */
export function getPreviewTagNames(
  rowTagNames: string[],
  {
    importedTags,
    matchedTagByKey,
    tagMappings,
    tagCreateNames,
    tagLabelById,
  }: {
    importedTags: string[]
    matchedTagByKey: Map<string, Tag>
    tagMappings: Record<string, string>
    tagCreateNames: Record<string, string>
    tagLabelById: Map<string, string>
  },
) {
  const valueByKey = new Map(importedTags.map((value) => [getNameKey(value), value]))
  const shown = new Map<string, string>()

  for (const name of rowTagNames) {
    const key = getNameKey(name)

    // Answers are held under one spelling for names differing only in capitals
    const value = valueByKey.get(key) ?? name
    const matched = matchedTagByKey.get(key)
    const answer = getImportNameAnswer(
      tagMappings[value] ?? '',
      Boolean(matched),
      tagCreateNames[value],
      CREATE_TAG_VALUE,
    )
    if (answer === SKIP_TAG_VALUE) continue

    let shownName = matched ? matched.name : value
    if (answer === CREATE_TAG_VALUE) shownName = (tagCreateNames[value] ?? value).trim() || value
    else if (answer) shownName = tagLabelById.get(answer) ?? name

    const shownKey = getNameKey(shownName)
    if (!shown.has(shownKey)) shown.set(shownKey, shownName)
  }

  return [...shown.values()]
}
