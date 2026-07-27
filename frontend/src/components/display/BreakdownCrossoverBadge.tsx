import { ArrowDownLeft, ArrowUpRight } from 'lucide-react'

type BreakdownCrossoverKind = 'income-loss' | 'expense-refund'

type BreakdownCrossoverBadgeProps = {
  kind: BreakdownCrossoverKind
}

const BADGE_CONFIG = {
  'income-loss': {
    Icon: ArrowDownLeft,
    label: 'Income loss',
    title: 'Income category counted as expense',
    background: 'var(--app-negative-soft)',
    borderColor: 'var(--app-negative-border)',
    color: 'var(--app-negative)',
  },
  'expense-refund': {
    Icon: ArrowUpRight,
    label: 'Expense refund',
    title: 'Expense category counted as income',
    background: 'var(--app-positive-soft)',
    borderColor: 'var(--app-positive)',
    color: 'var(--app-positive)',
  },
} as const

/**
 * Badge flagging a category whose amount crossed into the other side of a breakdown: an income category
 * counted as an expense, or an expense category counted as income, such as a refund
 */
export function BreakdownCrossoverBadge({ kind }: BreakdownCrossoverBadgeProps) {
  const { Icon, label, title, background, borderColor, color } = BADGE_CONFIG[kind]

  return (
    <span
      className="inline-flex h-4 shrink-0 items-center gap-0.5 rounded border px-1 text-[0.625rem] font-semibold leading-none"
      style={{ background, borderColor, color }}
      title={title}
    >
      <Icon size={10} strokeWidth={2.2} aria-hidden />
      {label}
    </span>
  )
}
