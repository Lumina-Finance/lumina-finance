import { formatCurrency } from '@/utils/formatCurrency'

export function getSavingsRate(income: number, expenses: number) {
  if (income <= 0) return null
  return Math.round(((income - expenses) / income) * 100)
}

export function formatSavingsRateValue(rate: number | null) {
  return rate === null ? 'N/A' : `${rate}%`
}

export function formatSignedCurrency(amount: number, currency: string) {
  if (amount === 0) return formatCurrency(amount, currency)
  return `${amount > 0 ? '+' : '-'}${formatCurrency(Math.abs(amount), currency)}`
}
