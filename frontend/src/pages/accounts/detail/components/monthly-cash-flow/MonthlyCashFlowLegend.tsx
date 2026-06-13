/**
 * Renders the inflow and outflow legend for the monthly cash flow card
 */
export function MonthlyCashFlowLegend() {
  return (
    <div
      className="flex items-center gap-3 text-xs"
      style={{ color: 'var(--app-text-subtle)' }}
    >
      <span className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-sm" style={{ background: 'var(--app-positive)' }} />
        In
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-sm" style={{ background: 'var(--app-negative)' }} />
        Out
      </span>
    </div>
  )
}
