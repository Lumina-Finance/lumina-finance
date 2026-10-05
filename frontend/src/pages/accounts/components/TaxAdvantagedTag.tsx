/**
 * Renders the small tag naming the tax-advantaged category an account is linked to. An
 * account's row and its institution's group header both carry it
 *
 * An `id` lets a row's link point to the tag as part of its description
 */
export function TaxAdvantagedTag({ name, id }: { name: string; id?: string }) {
  return (
    <span
      id={id}
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
