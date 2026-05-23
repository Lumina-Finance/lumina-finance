import { COLUMN_TARGETS } from '../constants'
import type { ColumnMap, ColumnTarget, ImportFileDraft } from '../types'
import { unique } from './common'
import { validateColumnMap, validateColumnValues } from './columnMapping'

const HEADER_ALIAS_SCORES: Record<ColumnTarget, Record<string, number>> = {
  account_id: {
    account: 100,
    accountname: 100,
    sourceaccount: 100,
    sourceaccountname: 100,
    bankaccount: 85,
    card: 70,
    cardname: 70,
  },
  dt: {
    date: 100,
    transactiondate: 100,
    transdate: 95,
    postingdate: 95,
    posteddate: 95,
    valuedate: 90,
    effectivedate: 90,
    datetime: 85,
  },
  category_id: {
    category: 100,
    categoryname: 100,
    transactioncategory: 95,
  },
  amount: {
    amount: 100,
    transactionamount: 100,
    rawamount: 100,
    signedamount: 100,
    value: 75,
    total: 65,
  },
  currency: {
    currency: 100,
    currencycode: 100,
    curr: 90,
    iso: 70,
  },
  merchant_id: {
    merchant: 100,
    merchantname: 100,
    payee: 95,
    payeename: 95,
    vendor: 90,
    vendorname: 90,
    counterparty: 85,
    description: 65,
    transactiondescription: 65,
    name: 50,
  },
  notes: {
    notes: 100,
    note: 100,
    memo: 95,
    comments: 90,
    comment: 90,
    reference: 80,
    details: 75,
    detail: 75,
    description: 45,
    transactiondescription: 45,
  },
  tag_ids: {
    tags: 100,
    tag: 100,
    labels: 90,
    label: 90,
  },
}

const HEADER_CONTAINS_SCORES: Record<ColumnTarget, Array<{ value: string; score: number }>> = {
  account_id: [
    { value: 'account name', score: 85 },
    { value: 'source account', score: 85 },
    { value: 'account', score: 60 },
  ],
  dt: [
    { value: 'transaction date', score: 90 },
    { value: 'posting date', score: 85 },
    { value: 'posted date', score: 85 },
    { value: 'date', score: 65 },
  ],
  category_id: [
    { value: 'category', score: 80 },
  ],
  amount: [
    { value: 'transaction amount', score: 90 },
    { value: 'signed amount', score: 90 },
    { value: 'amount', score: 70 },
  ],
  currency: [
    { value: 'currency code', score: 90 },
    { value: 'currency', score: 75 },
  ],
  merchant_id: [
    { value: 'merchant', score: 85 },
    { value: 'payee', score: 85 },
    { value: 'vendor', score: 80 },
    { value: 'description', score: 55 },
  ],
  notes: [
    { value: 'notes', score: 85 },
    { value: 'memo', score: 80 },
    { value: 'comment', score: 75 },
    { value: 'reference', score: 70 },
    { value: 'detail', score: 65 },
    { value: 'description', score: 40 },
  ],
  tag_ids: [
    { value: 'tags', score: 85 },
    { value: 'labels', score: 80 },
  ],
}

const EXCLUDED_HEADER_PARTS: Partial<Record<ColumnTarget, string[]>> = {
  account_id: ['number', 'no', 'iban', 'routing'],
  amount: ['balance', 'available', 'limit', 'rate'],
}

export function inferColumnMap(columnMap: ColumnMap, files: ImportFileDraft[]) {
  const result = validateColumnMap(columnMap, files)
  if (files.length === 0) return result

  const headers = unique(files.flatMap((file) => file.headers))
  const inferredMap = { ...result.map }

  const usedHeaders = new Set(Object.values(inferredMap).filter(Boolean))

  for (const target of COLUMN_TARGETS) {
    if (inferredMap[target.id]) continue

    const header = getBestHeaderMatch(files, headers, usedHeaders, target.id)
    if (!header) continue

    inferredMap[target.id] = header
    usedHeaders.add(header)
  }

  return validateColumnMap(inferredMap, files)
}

function getBestHeaderMatch(
  files: ImportFileDraft[],
  headers: string[],
  usedHeaders: Set<string>,
  target: ColumnTarget,
) {
  let bestMatch: { header: string; score: number } | null = null

  for (const header of headers) {
    if (usedHeaders.has(header)) continue

    const score = scoreHeaderForTarget(header, target)
    if (score <= 0) continue

    const validation = validateColumnValues(files, header, target)
    if (!validation.valid) continue

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { header, score }
    }
  }

  return bestMatch?.header ?? ''
}

function scoreHeaderForTarget(header: string, target: ColumnTarget) {
  const normalized = normalizeHeader(header)
  if (!normalized) return 0

  const excludedParts = EXCLUDED_HEADER_PARTS[target] ?? []
  if (excludedParts.some((part) => normalized.split(' ').includes(part))) return 0

  const compact = normalized.replace(/\s/g, '')
  const aliasScore = HEADER_ALIAS_SCORES[target][compact]
  if (aliasScore) return aliasScore

  const containsScore = HEADER_CONTAINS_SCORES[target].find((match) => normalized.includes(match.value))?.score
  return containsScore ?? 0
}

function normalizeHeader(header: string) {
  return header
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
