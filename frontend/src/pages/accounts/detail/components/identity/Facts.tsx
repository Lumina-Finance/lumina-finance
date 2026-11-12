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

  /** Lets a value too long for its column wrap onto further lines. The identity card cuts it off */
  wrapsValues?: boolean
}

/**
 * Renders account facts as small labels over values in two columns, as the identity card and the bank
 * link section set them out. A value too long for its column is cut off with an ellipsis, unless the
 * caller asks for it to wrap so it shows whole on a phone too, since nothing can be hovered there
 */
export function IdentityFacts({ facts, children, className = 'mt-5', wrapsValues = false }: IdentityFactsProps) {
  return (
    <dl className={`${className} grid grid-cols-2 gap-x-5 gap-y-3`}>
      {facts.map((fact) => (
        <div key={fact.label} className="min-w-0">
          <dt className="text-xs font-medium uppercase" style={{ color: 'var(--app-text-subtle)' }}>
            {fact.label}
          </dt>
          <dd className={`mt-0.5 ${wrapsValues ? 'break-words' : 'truncate'} text-sm font-medium`}>{fact.value}</dd>
        </div>
      ))}
      {children}
    </dl>
  )
}
