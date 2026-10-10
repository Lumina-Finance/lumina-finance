import type { ReactNode } from 'react'

type IdentityFact = {
  label: string
  value: string
}

type IdentityFactsProps = {
  facts: IdentityFact[]

  /** Facts that render themselves, such as the bank sync status, set out in the same grid after the rest */
  children?: ReactNode
  className?: string
}

/**
 * Renders account facts as small labels over values in two columns, as the identity card and the bank
 * link section set them out. A value too long for its column wraps onto further lines, so it shows
 * whole on a phone too, where nothing can be hovered
 */
export function IdentityFacts({ facts, children, className = 'mt-5' }: IdentityFactsProps) {
  return (
    <dl className={`${className} grid grid-cols-2 gap-x-5 gap-y-3`}>
      {facts.map((fact) => (
        <div key={fact.label} className="min-w-0">
          <dt className="text-xs font-medium uppercase" style={{ color: 'var(--app-text-subtle)' }}>
            {fact.label}
          </dt>
          <dd className="mt-0.5 break-words text-sm font-medium">{fact.value}</dd>
        </div>
      ))}
      {children}
    </dl>
  )
}
