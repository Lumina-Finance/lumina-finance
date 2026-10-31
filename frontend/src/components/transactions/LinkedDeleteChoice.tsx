import { Checkbox } from '@/components/forms/Checkbox'

interface LinkedDeleteChoiceProps {
  /** How many transactions outside the ones being deleted are linked to them */
  linkedCount: number

  /** What is being deleted, such as "this transaction" or "the 3 selected transactions" */
  subject: string
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}

/**
 * Asks what happens to the transactions linked to the ones being deleted: they stay and only the
 * links go, or they are deleted too. It stays unchecked, so deleting alone never takes a transaction
 * nobody picked, and draws nothing when no other transaction is linked
 */
export function LinkedDeleteChoice({ linkedCount, subject, checked, disabled, onChange }: LinkedDeleteChoiceProps) {
  if (linkedCount === 0) return null

  const linked = `${linkedCount} linked ${linkedCount === 1 ? 'transaction' : 'transactions'}`
  const label = `Also delete the ${linked}`
  return (
    <div className="space-y-3" data-testid="linked-delete-choice">
      <p className="text-sm leading-6" style={{ color: 'var(--app-text)' }}>
        {subject.charAt(0).toUpperCase() + subject.slice(1)} {linkedCount === 1 ? 'is' : 'are'} linked to{' '}
        {linkedCount === 1 ? 'another transaction' : `${linkedCount} other transactions`}.
      </p>
      <div className="flex items-start gap-3">
        <Checkbox checked={checked} disabled={disabled} label={label} onChange={() => onChange(!checked)} />
        {/* The checkbox is the keyboard and assistive target, so its text only has to take a click */}
        <p
          className="min-w-0 cursor-pointer text-sm font-medium leading-5"
          style={{ color: 'var(--app-text)' }}
          onClick={() => !disabled && onChange(!checked)}
        >
          {label}
        </p>
      </div>
    </div>
  )
}
