import { useState, type FormEvent } from 'react'
import { Check, Pencil, X } from 'lucide-react'
import { useUpdateTag, type Tag } from '@/api/tags'
import { scopeLabel } from '@/pages/settings/components/tag-settings-section/tagSettingsUtils'

export default function InlineTagEdit({
  isLast,
  tag,
  onCancel,
}: {
  isLast: boolean
  tag: Tag
  onCancel: () => void
}) {
  const updateTag = useUpdateTag()
  const [name, setName] = useState(tag.name)
  const [formError, setFormError] = useState<string | null>(null)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (updateTag.isPending) return

    const trimmed = name.trim()
    if (!trimmed) {
      setFormError('Name is required.')
      return
    }
    if (trimmed === tag.name) {
      onCancel()
      return
    }

    updateTag.mutate(
      {
        tagId: tag.id,
        payload: { name: trimmed },
      },
      {
        onSuccess: onCancel,
        onError: (error) => {
          setFormError(error instanceof Error ? error.message : 'Failed to update tag.')
        },
      },
    )
  }

  return (
    <tr
      style={{ borderBottom: isLast ? 'none' : '1px solid var(--app-border)' }}
    >
      <td colSpan={2} className="py-2 pl-4 pr-4 align-top">
        <form
          className="grid min-h-10 grid-cols-[minmax(0,1fr)_7rem] items-start gap-3"
          onSubmit={handleSubmit}
          noValidate
        >
          <div className="min-w-0">
            <div
              className="group flex h-9 min-w-0 items-center gap-1.5 rounded-md border px-2 transition-colors duration-150 hover:border-[var(--app-border-strong)] focus-within:border-[var(--app-accent-border)]"
              style={{
                background: 'var(--app-input-bg)',
                borderColor: 'var(--app-input-border)',
              }}
            >
              <input
                className="block h-8 min-w-0 flex-1 bg-transparent text-[0.9375rem] font-medium leading-8 outline-none"
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  setFormError(null)
                }}
                maxLength={64}
                aria-label={`${tag.name} name`}
                required
                style={{ color: 'var(--app-text)' }}
              />
              <Pencil
                size={13}
                className="shrink-0 opacity-45 transition-opacity duration-150 group-hover:opacity-70 group-focus-within:opacity-80"
                style={{ color: 'var(--app-text-subtle)' }}
                aria-hidden
              />
            </div>
            <p className="mt-1 truncate text-xs" style={{ color: 'var(--app-text-muted)' }}>
              {scopeLabel(tag)}
            </p>
            {formError && (
              <p className="mt-1 text-sm" style={{ color: 'var(--app-negative)' }}>
                {formError}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-1.5">
            <button
              type="submit"
              className="app-icon-button"
              disabled={updateTag.isPending}
              aria-label={`Save ${tag.name}`}
              title="Save"
            >
              {updateTag.isPending ? <div className="app-spinner" aria-label="Saving" /> : <Check size={16} aria-hidden />}
            </button>
            <button
              type="button"
              className="app-icon-button"
              onClick={onCancel}
              disabled={updateTag.isPending}
              aria-label={`Cancel editing ${tag.name}`}
              title="Cancel"
            >
              <X size={16} aria-hidden />
            </button>
          </div>
        </form>
      </td>
    </tr>
  )
}
