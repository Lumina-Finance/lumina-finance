/**
 * Renders the merchant distribution colour legend
 */
export function MerchantDistributionLegend({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`} style={{ color: 'var(--app-text-muted)' }}>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--app-chart-positive)' }} />
        Spend down
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--app-chart-negative)' }} />
        Spend up
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--app-accent)' }} />
        Flat
      </span>
    </div>
  )
}
