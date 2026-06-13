/**
 * Renders the standard account band when no tax-advantaged category is linked
 */
export function StandardAccountBand() {
  return (
    <div className="mt-5 pt-4 min-[750px]:mt-auto" style={{ borderTop: '1px solid var(--app-border)' }}>
      <p className="text-sm font-semibold">Standard account</p>
      <p className="mt-0.5 text-xs" style={{ color: 'var(--app-text-muted)' }}>
        No contribution or withdrawal limits
      </p>
    </div>
  )
}
