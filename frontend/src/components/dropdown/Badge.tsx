/**
 * Renders an option's badge as a pill, sized to sit inside a row of option text
 *
 * The pill carries a qualifier about the option rather than part of its name,
 * so it stays out of the accessible name and is announced separately
 */
export function DropdownBadge({ label }: { label: string }) {
  return (
    <span
      className="shrink-0 rounded-full px-1.5 py-0.5 text-[0.6875rem] font-semibold uppercase leading-none tracking-wide"
      style={{
        background: 'var(--app-accent-soft)',
        color: 'var(--app-accent)',
      }}
    >
      {label}
    </span>
  )
}
