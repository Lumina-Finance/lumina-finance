/**
 * Renders a compact category pill inside budget cards
 */
export default function BudgetCategoryRow({ label }: { label: string }) {
  return (
    <div
      className="flex h-8 items-center rounded-lg px-3 text-sm"
      style={{ background: 'var(--app-input-bg)', color: 'var(--app-text-muted)' }}
    >
      <span className="truncate">{label}</span>
    </div>
  )
}
