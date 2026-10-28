import { FieldError } from '@/components/forms/FieldError'

interface CreateModalSectionHeadingRowProps {
  label: string
  error?: string | false | null
  /** Id for the message, so the field it is about can point to it as its description */
  errorId?: string
}

/**
 * The heading of a create-modal section holding one field, with that field's validation message
 * opposite it, so the problem shows where the field is rather than in the footer
 */
export default function CreateModalSectionHeadingRow({ label, error, errorId }: CreateModalSectionHeadingRowProps) {
  return (
    <div className="flex min-h-4 items-center justify-between gap-3">
      <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>{label}</p>
      {/* One line of the message is 20px tall, so the margin keeps the row at the label's height until it wraps */}
      <FieldError message={error} id={errorId} className="-my-0.5" />
    </div>
  )
}
