import { IdentityBand } from './Band'

/**
 * Renders the standard account band when no tax-advantaged category is linked
 */
export function StandardAccountBand() {
  return (
    <IdentityBand>
      <p className="text-sm font-semibold">Standard account</p>
      <p className="mt-0.5 text-xs" style={{ color: 'var(--app-text-muted)' }}>
        No contribution or withdrawal limits
      </p>
    </IdentityBand>
  )
}
