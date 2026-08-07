import type { AccountsOverview } from '@/api/accounts'
import { CREATE_ACCOUNT_VALUE } from '@/pages/imports/constants'
import type { ImportAccountSource, ImportFileDraft } from '@/pages/imports/types'
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
 * `mapped` and `new` mean answered and `review` means the commit would refuse this row, so no row
 * reads as answered while the commit would refuse it. Whether the import as a whole can run is a
 * separate question, since the commit also refuses an import declaring more distinct values than
 * one request carries, which no row is at fault for. This mirrors every case of
 * `appendAccountMapping` in `payload.ts` that the step's own controls can produce, and the two have
 * to be changed together. The one case left out is an account type outside the supported set, which
 * that function also refuses and which only a control offering something other than
 * `ACCOUNT_TYPE_OPTIONS` could put on a row
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
 * Whether any mapping row on a step is answered create, which is what the new-account notice is for
 *
 * A row counts whether or not its type and currency are filled in, since choosing to create is what
 * the notice is about, which is why this does not go through `getImportAccountRowState` and its
 * stricter idea of an answered row
 *
 * @param rows - Every mapping row on the step, from both its tables
 */
export function isCreatingImportAccount(rows: Array<{ value: string }>): boolean {
  return rows.some((row) => row.value === CREATE_ACCOUNT_VALUE)
}

/**
 * Whether the batch bar's Apply may edit a row
 *
 * Apply fills in what the user has not settled, so it leaves alone an account they picked or that
 * was matched for them. The outside answer is only settled where it is legal, meaning on a source
 * no row is written to and where the user chose it themselves: a counterparty row resting on the
 * default it was given is still unanswered, and the same answer on a source rows are written to is
 * one the commit refuses, which the batch bar has to be able to lift the row out of since its own
 * dropdown does not offer that answer back
 *
 * @param value - The row's answer as it stands
 * @param isHandAnswered - Whether this source's answer came from the user rather than a default
 * @param isCounterpartyOnly - Whether no row is written to this source
 */
export function canApplyBatchEditToRow(
  value: string,
  isHandAnswered: boolean,
  isCounterpartyOnly: boolean,
): boolean {
  if (value === OUTSIDE_ACCOUNT_VALUE) return !isHandAnswered || !isCounterpartyOnly
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
 * silently file transactions against the wrong account. In the CSV flow that source then rests on
 * creating an account, since `applyCreateAccountFallback` covers every row source with no answer,
 * so a tie between two of the user's accounts ends up creating a third one carrying that name
 *
 * An import started from an account reaches neither of those. `applyFixedImportAccount` has already
 * answered every source rows are written to, so this only ever settles a transfer's counterparty
 * there
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
 * Files every source rows are written to into the one account an import was started from
 *
 * That account is the user's own answer rather than a guess, so it goes on before the name match,
 * which leaves an answered source alone, and before the create-new fallback, which then finds
 * nothing left to rest on create. It answers a source whose stored answer was cleared as well, since
 * the step shows no dropdown to answer one with while the account is fixed
 *
 * A counterparty-only source is left alone. No row is written to it, so it still asks which account
 * a transfer's money came from or went to, which may be any account or none
 *
 * @param sources - Every mapping source, cleared ones included
 * @param mappings - The answers as stored, before any match or default is layered on
 * @param accountId - The account the import was started from, null for an ordinary import, which
 *   returns the answers untouched
 */
export function applyFixedImportAccount(
  sources: ImportAccountSource[],
  mappings: Record<string, string>,
  accountId: string | null,
): Record<string, string> {
  if (!accountId) return mappings

  const next = { ...mappings }

  for (const source of sources) {
    if (source.isCounterpartyOnly) continue
    next[source.id] = accountId
  }

  return next
}

/**
 * Rests every row source the match could not place on creating an account
 *
 * A source rows are written to has to end up as some account, so creating one is the only answer
 * that is always available, and leaving the row blank asks the user for three answers where the
 * type alone would do. A counterparty-only source is left alone, since no row is written to it and
 * the outside answer is the right default there
 *
 * Kept out of `inferAccountMappings`, which the Firefly flow shares and which answers a different
 * question: which existing account a source is, with no answer being a legitimate result
 *
 * An import started from an account leaves nothing here to rest on create, since every source rows
 * are written to is answered before this runs
 *
 * @param sources - Every mapping source, cleared ones included, since a cleared row still has to be
 *   answerable and this fallback can only ever offer it a new account
 * @param resolved - The answers after the name match and the outside default
 */
export function applyCreateAccountFallback(
  sources: ImportAccountSource[],
  resolved: Record<string, string>,
): Record<string, string> {
  const next = { ...resolved }

  for (const source of sources) {
    if (source.isCounterpartyOnly || next[source.id]) continue
    next[source.id] = CREATE_ACCOUNT_VALUE
  }

  return next
}

/**
 * Whether a row's answer should carry the highlight saying the step filled it in from the file
 *
 * The highlight means an existing account was recognised from what the file says. Neither default
 * is that: the outside answer on a counterparty source and the create-new fallback are both what
 * the step falls back to having recognised nothing
 *
 * @param liveChoice - The answer as stored, empty unless the user gave one
 * @param resolvedChoice - The answer after the match and both defaults
 * @param isCounterpartyOnly - Whether no row is written to this source
 */
export function isAutoFilledAccountSource(
  liveChoice: string,
  resolvedChoice: string,
  isCounterpartyOnly: boolean,
): boolean {
  if (liveChoice || !resolvedChoice || resolvedChoice === CREATE_ACCOUNT_VALUE) return false
  return !(isCounterpartyOnly && resolvedChoice === OUTSIDE_ACCOUNT_VALUE)
}

/** An archived account a file appears to point at, carrying the id so the notice can link to it */
export interface ImportArchivedAccountMatch {
  id: string
  name: string
}

/**
 * Lists the archived accounts that an unmapped row source appears to point at
 *
 * Those sources are offered every account except an archived one, so a file pointing at one
 * matches nothing and the reason never reaches the user. A source that is only ever a transfer's
 * counterparty is left out, since it can record an archived account as it is
 *
 * Two sources can point at the same archived account, so each one is listed once. Two archived
 * accounts sharing a name are listed neither once nor twice: `findBestAccountNameMatch` refuses to
 * choose between accounts that tie, and identical names always tie
 *
 * @param resolvedMappings - The answers as they stand after the name match and before the
 *   create-new fallback. Given the finished map instead, every row source holds an answer and this
 *   returns nothing, so a user importing a file naming an account they archived would be told to
 *   unarchive nothing and would silently get a second account carrying that name
 */
export function getArchivedAccountMatches(
  sources: ImportAccountSource[],
  resolvedMappings: Record<string, string>,
  accounts: AccountsOverview[],
): ImportArchivedAccountMatch[] {
  const archivedAccounts = accounts.filter((account) => account.is_archived)
  if (archivedAccounts.length === 0) return []

  const matches: ImportArchivedAccountMatch[] = []
  const matchedIds = new Set<string>()

  for (const source of sources) {
    if (source.isCounterpartyOnly || resolvedMappings[source.id]) continue

    const match = findBestAccountNameMatch(source.matchText, archivedAccounts)
    if (!match || matchedIds.has(match.id)) continue

    matchedIds.add(match.id)
    matches.push({ id: match.id, name: match.name })
  }

  return matches
}

/**
 * Reads the currency each account source's own rows state
 *
 * A source counts as stating one only where every row of it that fills the currency cell fills it
 * with the same code, since two different codes leave nothing to choose between, and only where the
 * app supports that code, or the box would hold a value its own dropdown does not offer. It is
 * upper-cased
 * to match `resolveImportRow` and what the commit sends, so `usd` in the file and `USD` in the
 * dropdown are one answer rather than two
 *
 * @param files - The staged files, read row by row rather than through the unique-value helpers,
 *   since this has to see the currency each row states beside the source that row belongs to
 * @param accountHeader - The mapped account column, empty when the file itself is the source
 * @param currencyHeader - The mapped currency column, empty when none is mapped
 * @param supportedCurrencyCodes - Every code the app can store an account in
 * @returns The currency per source id, leaving out any source that states none, states more than
 *   one, or states one the app does not support
 */
export function getStatedCurrencyByAccountSource(
  files: ImportFileDraft[],
  accountHeader: string,
  currencyHeader: string,
  supportedCurrencyCodes: Set<string>,
): Record<string, string> {
  if (!currencyHeader) return {}

  // Null marks a source whose rows disagree, told apart from one no row has stated a currency for
  const statedBySource = new Map<string, string | null>()

  for (const file of files) {
    for (const row of file.rows) {
      // The same source id `buildImportAccountMappingSources` builds, which is the file rather than
      // a cell value when no account column is mapped
      const source = accountHeader ? row[accountHeader]?.trim() ?? '' : file.id
      if (!source) continue

      const code = (row[currencyHeader]?.trim() ?? '').toUpperCase()
      if (!code) continue

      const stated = statedBySource.get(source)
      statedBySource.set(source, stated === undefined || stated === code ? code : null)
    }
  }

  const currencyBySource: Record<string, string> = {}
  for (const [source, code] of statedBySource) {
    if (code && supportedCurrencyCodes.has(code)) currencyBySource[source] = code
  }

  return currencyBySource
}

/**
 * Settles the currency each row set to create an account is creating it in
 *
 * The user's own answer wins, then whatever the file states for that source, then nothing. The
 * user's base currency is deliberately not used: this value is not only shown, it lands on every
 * row of that account, where the decimal-places check and the currency-mismatch check both read it,
 * so guessing here either files a foreign statement in the wrong currency without a word or refuses
 * a correct file outright
 *
 * A source not creating an account is left out entirely, so a row moved off create stops carrying
 * a currency with nothing having to clear it
 *
 * @param storedCurrencies - The answers the user gave
 * @param mappings - The answers after the match and both defaults, which is what says who is creating
 * @param statedCurrencies - What each source's own rows state
 */
export function resolveImportAccountCreateCurrencies(
  storedCurrencies: Record<string, string>,
  mappings: Record<string, string>,
  statedCurrencies: Record<string, string>,
): Record<string, string> {
  const resolved: Record<string, string> = {}

  for (const [source, choice] of Object.entries(mappings)) {
    if (choice !== CREATE_ACCOUNT_VALUE) continue
    resolved[source] = storedCurrencies[source] || statedCurrencies[source] || ''
  }

  return resolved
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
