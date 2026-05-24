import { COLUMN_TARGETS, EMPTY_COLUMN_MAP } from '../constants'
import type { ColumnMap, ColumnTarget, ColumnValidationErrors, CsvRow, ImportFileDraft } from '../types'
import { unique } from './common'
import { isValidAmountValue, isValidCurrencyCode, isValidDateValue, truncateValue } from './valueParsers'

const COLUMN_VALIDATION_RULES: Record<ColumnTarget, {
  expected: string
  requiredValues?: boolean
  accepts: (value: string) => boolean
}> = {
  account_id: {
    expected: 'account names or source account labels; every row must have a value',
    requiredValues: true,
    accepts: isPlainTextValue,
  },
  dt: {
    expected: 'a valid date such as 2026-04-30 or 04/30/2026; every row must have a value',
    requiredValues: true,
    accepts: isValidDateValue,
  },
  category_id: {
    expected: 'category names as plain text; every row must have a value',
    requiredValues: true,
    accepts: isPlainTextValue,
  },
  amount: {
    expected: 'a raw signed number such as -12.34 or 1,234.56; every row must have a value',
    requiredValues: true,
    accepts: isValidAmountValue,
  },
  currency: {
    expected: '3-letter ISO currency codes such as CAD or USD',
    accepts: isValidCurrencyCode,
  },
  merchant_id: {
    expected: 'merchant or payee names as plain text',
    accepts: isPlainTextValue,
  },
  notes: {
    expected: 'plain text notes',
    accepts: isPlainTextValue,
  },
  tag_ids: {
    expected: 'tag names separated by commas, semicolons, or pipes',
    accepts: isPlainTextValue,
  },
}

export function validateColumnMap(columnMap: ColumnMap, files: ImportFileDraft[]) {
  if (files.length === 0) return { map: EMPTY_COLUMN_MAP, errors: {} }

  const availableHeaders = new Set(files.flatMap((file) => file.headers))
  const errors: ColumnValidationErrors = {}
  const map = { ...EMPTY_COLUMN_MAP }

  for (const target of COLUMN_TARGETS) {
    const header = columnMap[target.id]
    if (!header || !availableHeaders.has(header)) continue

    const validation = validateColumnValues(files, header, target.id)
    map[target.id] = header
    if (!validation.valid) errors[header] = validation.message
  }

  return { map, errors }
}

export function validateColumnValues(files: ImportFileDraft[], header: string, target: ColumnTarget) {
  const rule = COLUMN_VALIDATION_RULES[target]
  const values = getColumnValues(files, header)

  if (values.length === 0) {
    return {
      valid: false,
      message: `Expected ${rule.expected}. This column has no readable values.`,
    }
  }

  const blankCount = values.filter((value) => value.length === 0).length
  if (rule.requiredValues && blankCount > 0) {
    return {
      valid: false,
      message: `Expected ${rule.expected}. ${blankCount} row${blankCount === 1 ? '' : 's'} are blank.`,
    }
  }

  const invalidValue = values.filter(Boolean).find((value) => !rule.accepts(value))
  if (invalidValue) {
    return {
      valid: false,
      message: `Expected ${rule.expected}. "${truncateValue(invalidValue)}" does not match.`,
    }
  }

  return { valid: true, message: '' }
}

function getColumnValues(files: ImportFileDraft[], header: string) {
  return files.flatMap((file) => {
    if (!file.headers.includes(header)) return []
    return file.rows.map((row) => row[header]?.trim() ?? '')
  })
}

export function getMappedValue(row: CsvRow, header: string) {
  return header ? row[header]?.trim() ?? '' : ''
}

export function getTargetForHeader(columnMap: ColumnMap, header: string) {
  return COLUMN_TARGETS.find((target) => columnMap[target.id] === header)?.id ?? ''
}

export function getColumnSamples(files: ImportFileDraft[], header: string) {
  return unique(
    getColumnValues(files, header).filter(Boolean),
  ).slice(0, 3)
}

function isPlainTextValue() {
  return true
}
