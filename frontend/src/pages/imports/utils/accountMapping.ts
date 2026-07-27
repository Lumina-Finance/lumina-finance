import type { AccountsOverview } from '@/api/accounts'
import type { ImportAccountSource } from '../types'

/**
 * Guesses which existing account each import source belongs to by name, filling only the sources the
 * user has not already mapped by hand
 *
 * A source is left unmapped when two accounts score equally well, since guessing between them would
 * silently file transactions against the wrong account
 */
export function inferAccountMappings(
  sources: ImportAccountSource[],
  explicitMappings: Record<string, string>,
  accounts: AccountsOverview[],
) {
  const next = { ...explicitMappings }

  for (const source of sources) {
    if (next[source.id]) continue

    const match = findBestAccountNameMatch(source.matchText, accounts)
    if (match) next[source.id] = match.id
  }

  return next
}

/**
 * Turns an uploaded file name into the account label shown for it by dropping the CSV extension,
 * keeping the original name when stripping it would leave nothing behind
 */
export function getImportAccountName(fileName: string) {
  return fileName.replace(/\.csv$/i, '').trim() || fileName
}

function findBestAccountNameMatch(source: string, accounts: AccountsOverview[]) {
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
