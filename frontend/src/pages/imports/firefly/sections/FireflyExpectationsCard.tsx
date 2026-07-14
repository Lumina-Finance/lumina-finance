import { Info } from 'lucide-react'
import { IMPORT_INSET_STYLE } from '../../constants'

/**
 * One concept whose shape differs between the two apps, phrased as the user
 * knows it in Firefly III and what it becomes in Lumina
 */
interface ConceptMapping {
  firefly: string
  lumina: string
  // Marks the rows that describe data staying behind, which read quieter
  // than the rows describing data that converts
  excluded?: boolean
}

const CONCEPT_MAPPINGS: ConceptMapping[] = [
  {
    firefly: 'One transfer between two accounts',
    lumina: 'Two entries, one per account, so your transaction count ends up higher than your row count',
  },
  {
    firefly: 'Expense and revenue accounts, like shops and employers',
    lumina: 'Merchants, not accounts',
  },
  {
    firefly: 'A loan payment recorded as a withdrawal',
    lumina: 'A transfer between your account and the loan',
  },
  {
    firefly: 'A split transaction group',
    lumina: 'Separate entries that are no longer linked',
  },
  {
    firefly: 'Journal description, always required',
    lumina: 'Notes, which are optional here',
  },
  {
    firefly: 'Budget limits that changed over time',
    lumina: 'One monthly budget at the latest amount, backdated to its first transaction',
  },
  {
    firefly: 'Bills, recurring transactions, piggy banks, reconciliation flags, account interest and card details',
    lumina: 'Not supported yet',
    excluded: true,
  },
  {
    firefly: 'Rules and attachments',
    lumina: 'Never imported',
    excluded: true,
  },
]

/**
 * Static concept mapping shown at the top of the Firefly III flow so users
 * know which of their data changes shape on the way in, since the two apps
 * model transactions differently
 */
export function FireflyExpectationsCard() {
  return (
    <div className="rounded-lg px-4 py-3" style={IMPORT_INSET_STYLE}>
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center"
          style={{ color: 'var(--app-accent)' }}
          aria-hidden
        >
          <Info size={16} strokeWidth={2.25} />
        </span>
        <div className="min-w-0">
          <p className="text-[0.9375rem] font-semibold leading-5" style={{ color: 'var(--app-text)' }}>
            What To Expect
          </p>
          <p className="mt-1 text-sm leading-5" style={{ color: 'var(--app-text-muted)' }}>
            Firefly III records every journal against two accounts. Lumina records one entry per account, so some of
            your data changes shape on the way in.
          </p>

          {/* The table shares the text column beside the icon so it lines up
              with the wording it explains */}
          <table className="mt-3 w-full table-fixed border-collapse text-left text-sm">
            <thead>
              <tr style={{ color: 'var(--app-accent)' }}>
                <th className="w-2/5 pb-1.5 pr-4 text-xs font-medium uppercase tracking-wide">In Firefly III</th>
                <th className="w-3/5 pb-1.5 text-xs font-medium uppercase tracking-wide">In Lumina</th>
              </tr>
            </thead>
            <tbody>
              {CONCEPT_MAPPINGS.map((mapping) => (
                <tr key={mapping.firefly}>
                  {/* Both sides of a converting row read at full strength,
                      leaving the muted rows to mark what stays behind */}
                  <td
                    className="py-1.5 pr-4 align-top leading-5"
                    style={{
                      borderTop: '1px solid var(--app-border)',
                      color: mapping.excluded ? 'var(--app-text-subtle)' : 'var(--app-text)',
                    }}
                  >
                    {mapping.firefly}
                  </td>
                  <td
                    className="py-1.5 align-top leading-5"
                    style={{
                      borderTop: '1px solid var(--app-border)',
                      color: mapping.excluded ? 'var(--app-text-subtle)' : 'var(--app-text)',
                    }}
                  >
                    {mapping.lumina}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
