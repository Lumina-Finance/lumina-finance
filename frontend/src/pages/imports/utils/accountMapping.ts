import type { AccountsOverview } from '@/api/accounts'
import { CREATE_ACCOUNT_VALUE } from '@/pages/imports/constants'
import type { ImportAccountSource } from '@/pages/imports/types'
import { OUTSIDE_ACCOUNT_VALUE } from '@/utils/transfers'

/** Which of the three states a mapping row is in, as the line above the table counts them */
export type ImportAccountRowState = 'mapped' | 'new' | 'review'

/** One mapping row's answer, and the facts that decide whether the commit would accept it */
export interface ImportAccountRowAnswer {
  value: string

  /** Whether no row is written to this source, which is what makes the lenient answers legal */
  isCounterpartyOnly: boolean

  createType: string
  createCurrency: string

  /** Whether the account this row points at is archived, false for every other kind of answer */
  isArchivedAccount: boolean
}

/**
 * Says whether a mapping row is answered, and how
 *
 * `mapped` and `new` mean answered, `review` means the commit would refuse it, so the line above
 * the table cannot read as finished while the commit would stop. This mirrors `appendAccountMapping`
 * in `payload.ts` case for case, and the two have to be changed together
 */
export function getImportAccountRowState(row: ImportAccountRowAnswer): ImportAccountRowState {
  if (!row.value) return 'review'

  // The commit asks for both of these before it will create an account
  if (row.value === CREATE_ACCOUNT_VALUE) {
    return row.createType && row.createCurrency ? 'new' : 'review'
  }

  // Nothing is written to a counterparty source, which is why the outside answer and an archived
  // account are both accepted there and both refused on a source rows are written to
  if (row.isCounterpartyOnly) return 'mapped'

  return row.value === OUTSIDE_ACCOUNT_VALUE || row.isArchivedAccount ? 'review' : 'mapped'
}

/**
 * Counts the mapping rows in each state, for the line above the table
 */
export function countImportAccountRowStates(rows: ImportAccountRowAnswer[]) {
  const counts: Record<ImportAccountRowState, number> = { mapped: 0, new: 0, review: 0 }
  for (const row of rows) counts[getImportAccountRowState(row)] += 1
  return counts
}

/**
 * Whether the batch bar's Apply may edit a row
 *
 * Apply fills in what the user has not settled, so it leaves alone an account they picked or that
 * was matched for them, and leaves alone the outside answer where they chose it themselves. A
 * counterparty row resting on the outside answer it was given by default is still unanswered, so
 * Apply converts it like any other blank row
 *
 * @param value - The row's answer as it stands
 * @param isHandAnswered - Whether this source's answer came from the user rather than a default
 */
export function canApplyBatchEditToRow(value: string, isHandAnswered: boolean): boolean {
  if (value === OUTSIDE_ACCOUNT_VALUE) return !isHandAnswered
  return !value || value === CREATE_ACCOUNT_VALUE
}

/**
 * Drops every mapping pointing at an account that no longer exists, and says which sources lost one
 *
 * Judged against every account rather than the ones the dropdown offers, since a counterparty row
 * is deliberately allowed to keep an archived account that the list leaves out. The two answers
 * that are not account ids are left alone, or a row set to create an account would be cleared the
 * moment it was answered
 *
 * @param mappings - The answers as stored, before any match or default is layered on
 * @param accountById - Every account the user has, archived ones included
 */
export function dropVanishedAccountMappings(
  mappings: Record<string, string>,
  accountById: Map<string, AccountsOverview>,
) {
  const kept: Record<string, string> = {}
  const clearedSources = new Set<string>()

  for (const [source, choice] of Object.entries(mappings)) {
    const isAccountId = Boolean(choice) && choice !== CREATE_ACCOUNT_VALUE && choice !== OUTSIDE_ACCOUNT_VALUE
    if (isAccountId && !accountById.has(choice)) {
      clearedSources.add(source)
      continue
    }

    kept[source] = choice
  }

  return { mappings: kept, clearedSources }
}

/**
 * Guesses which existing account each import source belongs to by name, filling only the sources the
 * user has not already mapped by hand
 *
 * A source is left unmapped when two accounts score equally well, since guessing between them would
 * silently file transactions against the wrong account
 *
 * The two lists differ by which accounts each kind of source can be offered: a source no row is
 * written to can record an archived account, so matching it against the list the dropdown does not
 * offer would fill in a choice the user cannot see or change
 */
export function inferAccountMappings(
  sources: ImportAccountSource[],
  explicitMappings: Record<string, string>,
  { rowAccounts, counterpartyAccounts }: { rowAccounts: AccountsOverview[]; counterpartyAccounts: AccountsOverview[] },
) {
  const next = { ...explicitMappings }

  for (const source of sources) {
    if (next[source.id]) continue

    const match = findBestAccountNameMatch(source.matchText, source.isCounterpartyOnly ? counterpartyAccounts : rowAccounts)
    if (match) next[source.id] = match.id
  }

  return next
}

/**
 * Lists the archived accounts that an unmapped row source appears to point at
 *
 * Those sources are offered every account except an archived one, so a file pointing at one
 * matches nothing and the reason never reaches the user. A source that is only ever a transfer's
 * counterparty is left out, since it can record an archived account as it is
 */
export function getArchivedAccountMatches(
  sources: ImportAccountSource[],
  resolvedMappings: Record<string, string>,
  accounts: AccountsOverview[],
): string[] {
  const archivedAccounts = accounts.filter((account) => account.is_archived)
  if (archivedAccounts.length === 0) return []

  const matchedNames: string[] = []
  for (const source of sources) {
    if (source.isCounterpartyOnly || resolvedMappings[source.id]) continue

    const match = findBestAccountNameMatch(source.matchText, archivedAccounts)
    if (match && !matchedNames.includes(match.name)) matchedNames.push(match.name)
  }

  return matchedNames
}

/**
 * Turns an uploaded file name into the account label shown for it by dropping the CSV extension,
 * keeping the original name when stripping it would leave nothing behind
 */
export function getImportAccountName(fileName: string) {
  return fileName.replace(/\.csv$/i, '').trim() || fileName
}

/**
 * Returns the one account whose name best matches an import source, or null where nothing scores or
 * two accounts tie
 */
export function findBestAccountNameMatch(source: string, accounts: AccountsOverview[]) {
  let bestMatch: { account: AccountsOverview; score: number } | null = null
  let tied = false

  for (const account of accounts) {
    const score = scoreAccountNameMatch(source, account.name)
    if (score <= 0) continue

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { account, score }
      tied = false
      continue
    }

    if (score === bestMatch.score) tied = true
  }

  return bestMatch && !tied ? bestMatch.account : null
}

function scoreAccountNameMatch(source: string, accountName: string) {
  const normalizedSource = normalizeAccountName(source)
  const normalizedAccount = normalizeAccountName(accountName)
  if (!normalizedSource || !normalizedAccount) return 0

  const compactSource = normalizedSource.replace(/\s/g, '')
  const compactAccount = normalizedAccount.replace(/\s/g, '')
  if (normalizedSource === normalizedAccount || compactSource === compactAccount) return 100

  const cleanSource = removeAccountNoise(normalizedSource)
  const cleanAccount = removeAccountNoise(normalizedAccount)
  if (!cleanSource || !cleanAccount) return 0

  const cleanCompactSource = cleanSource.replace(/\s/g, '')
  const cleanCompactAccount = cleanAccount.replace(/\s/g, '')
  if (cleanSource === cleanAccount || cleanCompactSource === cleanCompactAccount) return 95

  const shorterLength = Math.min(cleanSource.length, cleanAccount.length)
  if (shorterLength >= 4 && (cleanSource.includes(cleanAccount) || cleanAccount.includes(cleanSource))) return 85

  const sourceTokens = new Set(cleanSource.split(' '))
  const accountTokens = new Set(cleanAccount.split(' '))
  const sharedCount = [...sourceTokens].filter((token) => accountTokens.has(token)).length
  const smallerTokenCount = Math.min(sourceTokens.size, accountTokens.size)
  const largerTokenCount = Math.max(sourceTokens.size, accountTokens.size)

  if (smallerTokenCount >= 2 && sharedCount === smallerTokenCount) return 80
  if (sharedCount / smallerTokenCount >= 0.67 && sharedCount / largerTokenCount >= 0.5) return 70

  return 0
}

function normalizeAccountName(value: string) {
  return value
    .replace(/\.[a-z0-9]+$/i, '')
    .toLowerCase()
    .replace(/\bchequing\b/g, 'checking')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function removeAccountNoise(value: string) {
  const noise = new Set(['account', 'acct', 'activity', 'csv', 'export', 'statement', 'transaction', 'transactions'])
  return value
    .split(' ')
    .filter((part) => part && !noise.has(part))
    .join(' ')
}
