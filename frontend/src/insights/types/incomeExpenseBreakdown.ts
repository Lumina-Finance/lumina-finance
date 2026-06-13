export type BreakdownMode = 'expense' | 'income'

export type BreakdownEntry = {
  id: string
  name: string
  categoryKind: BreakdownMode
  amount: number
}

export type CategoryDriver = {
  id: string
  name: string
  amount: number
  previousAmount: number
  changePct: number | null
  transactionCount: number
}

export type CategoryTrendSection = {
  id: 'increases' | 'decreases'
  label: string
  drivers: CategoryDriver[]
}
