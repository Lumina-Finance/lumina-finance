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
 * What the user has answered for one imported name, counting a name typed on a row nothing matches
 *
 * A name typed for a value nothing matches answers it as created, though the user never opened its
 * dropdown, since the row already read as being created
 *
 * @param answer - What the user chose for it, blank where they left it alone
 * @param matched - Whether the value already matches a record
 * @param typedName - The name typed for it, undefined where nothing was typed
 * @param createValue - The answer meaning create a new record
 */
export function getImportNameAnswer(
  answer: string,
  matched: boolean,
  typedName: string | undefined,
  createValue: string,
) {
  return !answer && !matched && typedName !== undefined ? createValue : answer
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
 * @param keepsCapitalCorrections - Whether a name differing from the value only in capitals is a
 *   correction worth sending, which holds where the commit writes the value's own capitals
 * @param maxNameLength - Most characters a name being created may have, unbounded when left out
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
  keepsCapitalCorrections = false,
  maxNameLength,
}: {
  values: string[]
  matchedByKey: Map<string, TMatched>
  answers: Record<string, string>
  createNames: Record<string, string>
  createValue: string
  skipValue: string
  noun: string
  buildChosen: (source: string, id: string) => TMapping
  keepsCapitalCorrections?: boolean
  maxNameLength?: number
}) {
  const mappings: (TMapping | { source: string; skip: true } | { source: string; create: { name: string } })[] = []
  const errors: string[] = []

  for (const value of values) {
    const key = getNameKey(value)
    const matched = matchedByKey.get(key)

    const answer = getImportNameAnswer(answers[value] ?? '', Boolean(matched), createNames[value], createValue)
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

      if (maxNameLength !== undefined && [...name].length > maxNameLength) {
        errors.push(`The name for the new ${noun} "${value}" is longer than ${maxNameLength} characters.`)
        continue
      }

      // Left out where it says nothing the commit would not do anyway, which is creating a record
      // under the value's own spelling when nothing matches it. Where the name is kept as written,
      // as a tag's is, a name in other capitals is a correction and is sent, since the commit writes
      // the file's own capitals
      const isOwnSpelling = keepsCapitalCorrections ? name === value.trim() : getNameKey(name) === key
      if (matched || !isOwnSpelling) mappings.push({ source: value, create: { name } })
      continue
    }

    // Left out where the chosen record is the one the value already matches
    if (!matched || matched.id !== answer) mappings.push(buildChosen(value, answer))
  }

  return { mappings, errors }
}

/**
 * Moves each answer held under another spelling of a name onto the spelling the step now asks about
 *
 * Answers are held under the spelling the step showed when they were given. Names differing only in
 * capitals are one name, and a date range can leave a different spelling of it in the rows, so an
 * answer given for "Travel" would otherwise be lost once only "travel" is left to ask about. An
 * answer under the exact spelling asked about wins, and answers for names the step no longer asks
 * about are left where they are
 *
 * @param answers - What the user chose, held under the spelling shown when they chose it
 * @param values - One name per record the step asks about now
 * @returns The same object where nothing needed moving
 */
export function alignNameAnswersWithValues<T>(answers: Record<string, T>, values: string[]): Record<string, T> {
  const valueByKey = new Map(values.map((value) => [getNameKey(value), value]))
  let aligned = answers

  for (const [spelling, answer] of Object.entries(answers)) {
    const value = valueByKey.get(getNameKey(spelling))
    if (value === undefined || value === spelling || value in aligned) continue

    if (aligned === answers) aligned = { ...answers }
    delete aligned[spelling]
    aligned[value] = answer
  }

  return aligned
}
