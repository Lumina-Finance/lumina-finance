type IdentityFact = {
  label: string
  value: string
}

type IdentityFactsProps = {
  facts: IdentityFact[]
}

/**
 * Renders the static account facts inside the identity card
 */
export function IdentityFacts({ facts }: IdentityFactsProps) {
  return (
    <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-3">
      {facts.map((fact) => (
        <div key={fact.label} className="min-w-0">
          <dt className="text-xs font-medium uppercase" style={{ color: 'var(--app-text-subtle)' }}>
            {fact.label}
          </dt>
          <dd className="mt-0.5 truncate text-sm font-medium">{fact.value}</dd>
        </div>
      ))}
    </dl>
  )
}
