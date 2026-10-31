import { getNameKey } from '@/api/shared/nameKey'

/**
 * What one imported name resolves to once the file's matches and the user's answer are both read
 *
 * Shared by the merchant and tag steps, which answer a value the same three ways
 *
 * @param answer - What the user chose for it, blank where they left it alone
 * @param matched - Whether the value already matches a record
 * @param createValue - The answer meaning create a new record
 * @param skipValue - The answer meaning use none
 */
export function getImportNameRowState(answer: string, matched: boolean, createValue: string, skipValue: string) {
  if (answer === skipValue) return 'skipped' as const
  if (answer === createValue) return 'creating' as const
  if (answer) return 'chosen' as const
  return matched ? ('matched' as const) : ('creating' as const)
}

/**
 * Builds the answers a commit payload carries for one kind of imported name
 *
 * Only a value answered differently from what the commit would do unasked is sent, so a file
 * carrying thousands of distinct values nobody touched declares none of them and is not refused for
 * declaring more than an import may carry
 *
 * @param values - One name per record the file resolves to
 * @param matchedByKey - The records the file's values already match, by the key a name is matched under
 * @param answers - What the user chose for each value, blank where they left it alone
 * @param createNames - The name the user wrote for a value being created
 * @param createValue - The answer meaning create a new record
 * @param skipValue - The answer meaning use none
 * @param noun - What the record is called in a message, such as merchant
 * @param buildChosen - Builds the mapping that points a value at the record with the given id
 */
export function buildImportNameMappings<TMatched extends { id: string }, TMapping extends { source: string }>({
  values,
  matchedByKey,
  answers,
  createNames,
  createValue,
  skipValue,
  noun,
  buildChosen,
}: {
  values: string[]
  matchedByKey: Map<string, TMatched>
  answers: Record<string, string>
  createNames: Record<string, string>
  createValue: string
  skipValue: string
  noun: string
  buildChosen: (source: string, id: string) => TMapping
}) {
  const mappings: (TMapping | { source: string; skip: true } | { source: string; create: { name: string } })[] = []
  const errors: string[] = []

  for (const value of values) {
    const key = getNameKey(value)
    const matched = matchedByKey.get(key)

    // A name typed for a value nothing matches answers it as created, though the user never
    // opened its dropdown, since the row already read as being created
    let answer = answers[value] ?? ''
    if (!answer && !matched && createNames[value] !== undefined) answer = createValue
    if (!answer) continue

    if (answer === skipValue) {
      mappings.push({ source: value, skip: true })
      continue
    }

    if (answer === createValue) {
      const name = (createNames[value] ?? value).trim()
      if (!name) {
        errors.push(`Choose a name for the new ${noun} "${value}".`)
        continue
      }

      // Left out where it says nothing the commit would not do anyway, which is creating a record
      // under the value's own spelling when nothing matches it
      if (matched || getNameKey(name) !== key) mappings.push({ source: value, create: { name } })
      continue
    }

    // Left out where the chosen record is the one the value already matches
    if (!matched || matched.id !== answer) mappings.push(buildChosen(value, answer))
  }

  return { mappings, errors }
}
