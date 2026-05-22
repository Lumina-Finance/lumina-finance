import type { AccountsOverview } from '@/api/accounts'

export function getResolvedAccountChoice(explicitValue: string | undefined) {
  return explicitValue || ''
}

export function inferAccountMappings(
  sources: string[],
  explicitMappings: Record<string, string>,
  accounts: AccountsOverview[],
) {
  const next = { ...explicitMappings }

  for (const source of sources) {
    if (next[source]) continue

    const match = findBestAccountNameMatch(source, accounts)
    if (match) next[source] = match.id
  }

  return next
}

export function resolveImportAccountChoice(
  source: string,
  explicitValue: string | undefined,
  accounts: AccountsOverview[],
) {
  const explicitChoice = getResolvedAccountChoice(explicitValue)
  return explicitChoice || findBestAccountNameMatch(source, accounts)?.id || ''
}

export function getResolvedAccountCreateType(
  rowId: string,
  accountCreateTypes: Record<string, string>,
) {
  return accountCreateTypes[rowId] || ''
}

export function getResolvedAccountCreateCurrency(
  rowId: string,
  accountCreateCurrencies: Record<string, string>,
) {
  return accountCreateCurrencies[rowId] || ''
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
