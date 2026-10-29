import { Landmark } from 'lucide-react'

type BankSourcePanelProps = {
  providerName: string

  /** The bank's own description of the transaction, as it last sent it */
  description: string
}

/**
 * Heads the form of a bank-imported transaction with the provider it came from and the bank's own
 * description, which is always read-only, since the ledger has no description field and only the
 * bank changes it
 *
 * The labels take the muted colour, which keeps them above 4.5:1 on the panel in both themes
 */
export default function TransactionBankSourcePanel({ providerName, description }: BankSourcePanelProps) {
  return (
    <div className="app-card px-4 py-3">
      <p
        className="flex items-center gap-1.5 text-xs font-semibold uppercase"
        style={{ color: 'var(--app-text-muted)' }}
      >
        <Landmark size={13} aria-hidden />
        From {providerName}
      </p>
      <dl className="mt-2">
        <dt className="text-xs font-medium" style={{ color: 'var(--app-text-muted)' }}>
          Bank description
        </dt>
        <dd className="mt-0.5 break-words text-sm font-medium" style={{ color: 'var(--app-text)' }}>
          {description}
        </dd>
      </dl>
    </div>
  )
}
