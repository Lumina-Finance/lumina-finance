/**
 * Removes unsupported characters while keeping one decimal separator for live money inputs
 */
export function sanitizeMoneyInput(value: string): string {
  let sanitized = value.replace(/[^\d.]/g, '')
  const parts = sanitized.split('.')
  if (parts.length > 1) sanitized = `${parts[0]}.${parts.slice(1).join('')}`
  if (sanitized.startsWith('.')) sanitized = `0${sanitized}`
  return sanitized
}

/**
 * Formats the integer side of a live money input without losing an active decimal
 */
export function formatMoneyInputLive(value: string): string {
  if (!value.trim()) return value
  const [integerPart, decimalPart] = value.split('.', 2)
  const formattedInteger = integerPart
    ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Number(integerPart))
    : '0'
  return value.includes('.') ? `${formattedInteger}.${decimalPart ?? ''}` : formattedInteger
}
