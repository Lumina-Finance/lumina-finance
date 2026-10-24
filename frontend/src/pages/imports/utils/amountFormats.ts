import type { ImportAmountDirection } from '@/pages/imports/types'

// The separators available for the fractional part of an imported amount
export const IMPORT_AMOUNT_DECIMAL_SEPARATORS = ['.', ','] as const

// Space covers ordinary, non-breaking and narrow non-breaking spaces
export const IMPORT_AMOUNT_GROUPING_SEPARATORS = [',', '.', 'space', "'", 'none'] as const

export type ImportAmountDecimalSeparator = (typeof IMPORT_AMOUNT_DECIMAL_SEPARATORS)[number]
export type ImportAmountGroupingSeparator = (typeof IMPORT_AMOUNT_GROUPING_SEPARATORS)[number]
export type ImportAmountSign = 'negative' | 'positive' | 'unsigned'

export interface ImportAmountFormat {
  decimalSeparator: ImportAmountDecimalSeparator
  groupingSeparator: ImportAmountGroupingSeparator
}

export interface ImportAmountReading {
  normalized: string
  sign: ImportAmountSign
  isZero: boolean
}

export const DEFAULT_IMPORT_AMOUNT_FORMAT: ImportAmountFormat = {
  decimalSeparator: '.',
  groupingSeparator: ',',
}

export const NORMALIZED_IMPORT_AMOUNT_FORMAT: ImportAmountFormat = {
  decimalSeparator: '.',
  groupingSeparator: 'none',
}

export const IMPORT_AMOUNT_FORMATS: readonly ImportAmountFormat[] = [
  DEFAULT_IMPORT_AMOUNT_FORMAT,
  { decimalSeparator: ',', groupingSeparator: '.' },
  { decimalSeparator: '.', groupingSeparator: 'space' },
  { decimalSeparator: ',', groupingSeparator: 'space' },
  { decimalSeparator: '.', groupingSeparator: "'" },
  { decimalSeparator: ',', groupingSeparator: "'" },
  NORMALIZED_IMPORT_AMOUNT_FORMAT,
  { decimalSeparator: ',', groupingSeparator: 'none' },
]

const SPACE_GROUPING_PATTERN = /[ \u00a0\u202f]/
const ALL_SPACE_GROUPING_PATTERN = /[ \u00a0\u202f]/g

// Every character a bank or a spreadsheet writes as a minus: the hyphen-minus, the Unicode hyphens,
// the figure, en and em dashes, the horizontal bar, the minus sign and their small and fullwidth
// forms. Each reads as a minus, since one taken for text would bring money out in as money in
export const MINUS_CHARACTERS ='\\-\\u2010-\\u2015\\u2212\\uFE58\\uFE63\\uFF0D'
const MINUS_PATTERN = new RegExp(`^[${MINUS_CHARACTERS}]$`, 'u')
const SIGN_CHARACTERS = `+${MINUS_CHARACTERS}`
const EXTRA_SIGN_PATTERN = new RegExp(`[${SIGN_CHARACTERS}]`, 'u')
const LEADING_SIGN_PATTERN = new RegExp(`^[${SIGN_CHARACTERS}]`, 'u')
const PARENTHESIS_PATTERN = /[()]/
const NUMERIC_PUNCTUATION_PATTERN = /[.,']/
const NON_ASCII_DECIMAL_DIGIT_PATTERN = /(?![0-9])\p{Decimal_Number}/u

// Leading text such as a currency symbol, then one sign with only spaces between it and the digits,
// as some banks write `R$ -10,00`. The text before it is checked like any other prefix
const SIGN_AFTER_LEADING_TEXT_PATTERN = new RegExp(
  `^([^${SIGN_CHARACTERS}0-9]+)([${SIGN_CHARACTERS}])(?=[ \\u{a0}\\u{202f}]*[0-9])`,
  'u',
)

/**
 * Reads one amount under a selected decimal and grouping format
 *
 * Text and symbols may surround the digits. A sign comes either first or between the leading text
 * and the digits, as in `R$ -10,00`, and text cannot split the digits. The returned decimal text retains the sign and fraction digits while removing grouping
 *
 * @param rawValue - The cell as it appears in the file
 * @param format - The separators selected for the whole import
 * @returns The normalized amount and its exact classification, or null when the cell does not fit
 */
export function readImportAmount(rawValue: string, format: ImportAmountFormat): ImportAmountReading | null {
  // Decimal digits outside ASCII are part of the amount, not discardable currency text. Refuse
  // them before choosing the ASCII numeric span so a prefix or suffix cannot shorten the value
  if (NON_ASCII_DECIMAL_DIGIT_PATTERN.test(rawValue)) return null
  if (format.decimalSeparator === format.groupingSeparator) return null

  const trimmed = rawValue.trim()
  if (!trimmed || PARENTHESIS_PATTERN.test(trimmed)) return null

  const leadingSign = LEADING_SIGN_PATTERN.exec(trimmed)?.[0] ?? ''
  const currencySign = leadingSign ? null : SIGN_AFTER_LEADING_TEXT_PATTERN.exec(trimmed)
  const amountSign = leadingSign || (currencySign?.[2] ?? '')
  const unsignedValue = leadingSign
    ? trimmed.slice(leadingSign.length)
    : currencySign
      ? `${currencySign[1]}${trimmed.slice(currencySign[0].length)}`
      : trimmed
  if (EXTRA_SIGN_PATTERN.test(unsignedValue)) return null

  const firstDigit = unsignedValue.search(/[0-9]/)
  const lastDigit = findLastDigitIndex(unsignedValue)
  if (firstDigit === -1 || lastDigit === -1) return null

  const prefix = unsignedValue.slice(0, firstDigit)
  const numericPart = unsignedValue.slice(firstDigit, lastDigit + 1)
  const suffix = unsignedValue.slice(lastDigit + 1)
  if (!isDiscardableAmountText(prefix) || !isDiscardableAmountText(suffix)) return null

  const decimalParts = numericPart.split(format.decimalSeparator)
  if (decimalParts.length > 2) return null

  const [whole, fraction] = decimalParts
  if (!whole || (fraction !== undefined && !/^\d+$/.test(fraction))) return null

  const wholeDigits = readWholeAmountDigits(whole, format.groupingSeparator)
  if (wholeDigits === null) return null

  const signCharacter = MINUS_PATTERN.test(amountSign) ? '-' : amountSign
  const normalized = `${signCharacter}${wholeDigits}${fraction === undefined ? '' : `.${fraction}`}`
  const sign = signCharacter === '-' ? 'negative' : signCharacter === '+' ? 'positive' : 'unsigned'

  return {
    normalized,
    sign,
    isZero: !/[1-9]/.test(`${wholeDigits}${fraction ?? ''}`),
  }
}

/** Reports whether a cell can be read under at least one supported amount format */
export function isValidMappedImportAmount(value: string) {
  return IMPORT_AMOUNT_FORMATS.some((format) => readImportAmount(value, format) !== null)
}

// An optional sign, then digits and the separators the supported formats use, with nothing else
const BARE_AMOUNT_PATTERN = new RegExp(`^[${SIGN_CHARACTERS}]?[0-9][0-9.,' \\u00a0\\u202f]*$`, 'u')

/**
 * Reports whether a cell is nothing but an amount in some supported format, for the guesser that
 * works before a format is chosen
 *
 * Narrower than `isValidMappedImportAmount`, which also lets currency text and symbols sit beside
 * the digits. Guessing from a value must not turn a code or a reference containing a number into
 * an amount, so the cell may carry only a sign, digits and separators
 */
export function isBareImportAmount(value: string) {
  const trimmed = value.trim()
  return BARE_AMOUNT_PATTERN.test(trimmed) && isValidMappedImportAmount(trimmed)
}

/** Reads decimal text that has already been normalized for the backend */
export function readNormalizedImportAmount(value: string) {
  return readImportAmount(value, NORMALIZED_IMPORT_AMOUNT_FORMAT)
}

/** Applies a separate direction to a normalized reading without converting its decimal digits */
export function applyImportAmountReadingDirection(
  reading: ImportAmountReading,
  direction: ImportAmountDirection,
) {
  const unsigned = reading.normalized.replace(/^[-+]/, '')
  if (reading.isZero || direction === 'in') return unsigned
  return `-${unsigned}`
}

/** Reports whether an explicit nonzero sign contradicts a direction supplied outside the amount */
export function doesImportAmountReadingSignDisagreeWithDirection(
  reading: ImportAmountReading,
  direction: ImportAmountDirection,
) {
  if (reading.isZero) return false
  return direction === 'out' ? reading.sign === 'positive' : reading.sign === 'negative'
}

/** Finds the final Latin digit without converting the amount to a JavaScript number */
function findLastDigitIndex(value: string) {
  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (/[0-9]/.test(value[index])) return index
  }
  return -1
}

/**
 * Reports whether text beside an amount can be discarded without hiding numeric punctuation
 *
 * Whitespace alone is allowed. Supported numeric punctuation is never discarded, so a partial
 * number such as `.5` cannot become `5`
 */
function isDiscardableAmountText(value: string) {
  const compact = value.replace(ALL_SPACE_GROUPING_PATTERN, '')
  if (!compact) return true
  if (EXTRA_SIGN_PATTERN.test(compact) || PARENTHESIS_PATTERN.test(compact) || /[0-9]/.test(compact)) return false
  return !NUMERIC_PUNCTUATION_PATTERN.test(compact)
}

/** Reads and removes a valid grouping separator from the whole-number digits */
function readWholeAmountDigits(whole: string, groupingSeparator: ImportAmountGroupingSeparator) {
  if (/^\d+$/.test(whole)) return whole
  if (groupingSeparator === 'none') return null

  if (groupingSeparator === 'space') {
    if (!/^\d{1,3}(?:[ \u00a0\u202f]\d{3})+$/.test(whole)) return null
    return whole.replace(ALL_SPACE_GROUPING_PATTERN, '')
  }

  if (SPACE_GROUPING_PATTERN.test(whole)) return null
  const escapedSeparator = groupingSeparator === '.' ? '\\.' : groupingSeparator
  const groupedPattern = new RegExp(`^\\d{1,3}(?:${escapedSeparator}\\d{3})+$`)
  return groupedPattern.test(whole) ? whole.split(groupingSeparator).join('') : null
}
