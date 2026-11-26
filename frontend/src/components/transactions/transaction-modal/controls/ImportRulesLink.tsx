import { IMPORT_RULES_SETTINGS_PATH } from '@/components/transactions/transaction-modal/constants'

/**
 * A link to Import rules in Settings, in the app's inline link style. It opens a new tab, since the
 * form keeps what the person has entered only until it is added
 */
export default function ImportRulesLink() {
  return (
    <a
      href={IMPORT_RULES_SETTINGS_PATH}
      target="_blank"
      rel="noopener noreferrer"
      className="app-inline-link font-medium whitespace-nowrap underline underline-offset-2 transition-control"
      style={{ color: 'var(--app-accent)' }}
    >
      Open import rules<span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}
