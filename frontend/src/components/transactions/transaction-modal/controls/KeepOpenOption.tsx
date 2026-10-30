import { Checkbox } from '@/components/forms/Checkbox'

type KeepOpenOptionProps = {
  label: string
  description: string
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}

/**
 * The footer's choice to keep the modal open after an action, so the next entry follows on from it
 */
export default function TransactionKeepOpenOption({
  label,
  description,
  checked,
  disabled,
  onChange,
}: KeepOpenOptionProps) {
  return (
    <div className="min-w-0 sm:max-w-xs">
      <label className="-ml-1 flex cursor-pointer items-center gap-3 rounded-xl px-1 py-1">
        <Checkbox label={label} checked={checked} disabled={disabled} onChange={() => onChange(!checked)} />
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
