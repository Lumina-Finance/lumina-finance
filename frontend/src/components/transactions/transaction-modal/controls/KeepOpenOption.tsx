import { useTransactionModalIds } from '@/components/transactions/transaction-modal/ids'

type KeepOpenOptionProps = {
  label: string
  description: string
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}

/**
 * The footer's choice to keep the modal open after an action, so the next entry follows on from it. A
 * native checkbox inside its label, so its name holds both lines
 */
export default function TransactionKeepOpenOption({
  label,
  description,
  checked,
  disabled,
  onChange,
}: KeepOpenOptionProps) {
  const id = useTransactionModalIds().keepOpen

  return (
    <div className="min-w-0 sm:max-w-xs">
      <label htmlFor={id} className="-ml-1 flex cursor-pointer items-center gap-3 rounded-xl px-1 py-1">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          disabled={disabled}
          className="h-4 w-4 shrink-0 cursor-pointer disabled:cursor-not-allowed"
          style={{ accentColor: 'var(--app-accent)' }}
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium" style={{ color: 'var(--app-text)' }}>
            {label}
          </span>
          <span className="block text-xs" style={{ color: 'var(--app-text-muted)' }}>
            {description}
          </span>
        </span>
      </label>
    </div>
  )
}
