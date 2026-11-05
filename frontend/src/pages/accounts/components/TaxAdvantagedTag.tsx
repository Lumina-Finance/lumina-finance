/**
 * Renders the small tag naming the tax-advantaged category an account is linked to. An
 * account's row and its institution's group header both carry it
 */
export function TaxAdvantagedTag({ name }: { name: string }) {
  return (
    <span
      className="shrink-0 rounded-md px-2 py-0.5 text-xs font-medium"
      style={{
        background: 'var(--app-accent-soft)',
        color: 'var(--app-accent-on-page-tint)',
        border: '1px solid var(--app-accent-border)',
      }}
    >
      {name}
    </span>
  )
}
