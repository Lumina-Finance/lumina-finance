export function normalizeImportDate(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''

  const isoMatch = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
  if (isoMatch) {
    const year = Number(isoMatch[1])
    const month = Number(isoMatch[2])
    const day = Number(isoMatch[3])
    return isValidDateParts(year, month, day) ? formatYmd(year, month, day) : ''
  }

  const slashMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/)
  if (slashMatch) {
    const first = Number(slashMatch[1])
    const second = Number(slashMatch[2])
    const year = normalizeDateYear(Number(slashMatch[3]))
    if (isValidDateParts(year, first, second)) return formatYmd(year, first, second)
    if (isValidDateParts(year, second, first)) return formatYmd(year, second, first)
    return ''
  }

  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return ''
  return formatYmd(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate())
}

export function getPreviewDateLabel(ymd: string) {
  if (!ymd) return 'Missing Date'
  const [year, month, day] = ymd.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function formatYmd(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function toMinorUnits(value: number, currency: string) {
  return Math.round(value * 10 ** getCurrencyExponent(currency))
}

function getCurrencyExponent(currency: string) {
  try {
    const formatter = new Intl.NumberFormat(undefined, { style: 'currency', currency })
    return formatter.resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    return 2
  }
}

export function isSupportedCurrency(currency: string) {
  if (!isValidCurrencyCode(currency)) return false

  try {
    new Intl.NumberFormat(undefined, { style: 'currency', currency })
    return true
  } catch {
    return false
  }
}

export function isValidDateValue(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return false

  const isoMatch = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
  if (isoMatch) {
    return isValidDateParts(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]))
  }

  const slashMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/)
  if (slashMatch) {
    const first = Number(slashMatch[1])
    const second = Number(slashMatch[2])
    const year = normalizeDateYear(Number(slashMatch[3]))
    return isValidDateParts(year, first, second) || isValidDateParts(year, second, first)
  }

  return /[a-z]/i.test(trimmed) && !Number.isNaN(Date.parse(trimmed))
}

function normalizeDateYear(year: number) {
  if (year >= 100) return year
  return year >= 70 ? 1900 + year : 2000 + year
}

function isValidDateParts(year: number, month: number, day: number) {
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

export function isValidAmountValue(value: string) {
  return parseImportNumber(value) !== null
}

export function parseImportNumber(value: string) {
  const normalized = value.trim()
  if (!normalized) return null

  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(normalized)) return null

  const parsed = Number(normalized.replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

export function isValidCurrencyCode(value: string) {
  return /^[A-Z]{3}$/i.test(value.trim())
}

export function truncateValue(value: string) {
  return value.length > 28 ? `${value.slice(0, 25)}...` : value
}
