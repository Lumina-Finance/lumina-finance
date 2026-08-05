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

/**
 * Renders an option's count as a round accent pill, for a list whose options each stand for a number
 * of things rather than for one value
 */
export function DropdownCount({ count }: { count: number }) {
  return (
    <span
      className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-medium"
      style={{
        background: 'var(--app-accent-soft)',
        color: 'var(--app-accent)',
      }}
    >
      {count}
    </span>
  )
}
