import { useRef, useState, type FormEvent } from 'react'
import { Check, Pencil, X } from 'lucide-react'
import { useUpdateCategory, type Category } from '@/api/categories'
import CategoryIconSelector from '@/components/category-icon-selector/CategoryIconSelector'
import { editableEmoji } from '@/pages/settings/components/category-settings-section/categorySettingsUtils'

export default function InlineCategoryEdit({
  category,
  isLast,
  onCancel,
}: {
  category: Category
  isLast: boolean
  onCancel: () => void
}) {
  const updateCategory = useUpdateCategory()
  const formRef = useRef<HTMLFormElement | null>(null)
  const [form, setForm] = useState({
    name: category.name,
    icon: editableEmoji(category.icon),
  })
  const [formError, setFormError] = useState<string | null>(null)

  const setField = (field: 'name' | 'icon', value: string) => {
    setForm((current) => ({ ...current, [field]: value }))
    setFormError(null)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (updateCategory.isPending) return

    const name = form.name.trim()
    if (!name) {
      setFormError('Name is required.')
      return
    }
    if (name === category.name && form.icon === editableEmoji(category.icon)) {
      onCancel()
      return
    }

    updateCategory.mutate(
      {
        categoryId: category.id,
        payload: {
          name,
          icon: form.icon,
        },
      },
      {
        onSuccess: onCancel,
        onError: (error) => {
          setFormError(error instanceof Error ? error.message : 'Failed to update category.')
        },
      },
    )
  }

  return (
    <form
      ref={formRef}
      className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 py-2"
      style={{ borderBottom: isLast ? 'none' : '1px solid var(--app-border)' }}
      onSubmit={handleSubmit}
      noValidate
    >
      <div className="flex min-w-0 items-start gap-3">
        <CategoryIconSelector
          value={form.icon}
          categoryName={category.name}
          onChange={(icon) => setField('icon', icon)}
          pickerAnchor="row"
          pickerAnchorRef={formRef}
        />
        <div className="min-w-0 flex-1">
          <div
            className="group flex h-9 min-w-0 items-center gap-1.5 rounded-md border px-2 transition-colors duration-150 hover:border-[var(--app-border-strong)] focus-within:border-[var(--app-accent-border)]"
            style={{
              background: 'var(--app-input-bg)',
              borderColor: 'var(--app-input-border)',
            }}
          >
            <input
              className="block h-8 min-w-0 flex-1 bg-transparent text-[0.9375rem] font-medium leading-8 outline-none"
              value={form.name}
              onChange={(event) => setField('name', event.target.value)}
              maxLength={256}
              aria-label={`${category.name} name`}
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
          {formError && (
            <p className="mt-1 text-sm" style={{ color: 'var(--app-negative)' }}>
              {formError}
            </p>
          )}
        </div>
      </div>
      <div className="flex h-9 items-center justify-end gap-1.5">
        <button
          type="submit"
          className="app-icon-button h-9 w-9"
          disabled={updateCategory.isPending}
          aria-label={`Save ${category.name}`}
          title="Save"
        >
          {updateCategory.isPending ? <div className="app-spinner" aria-label="Saving" /> : <Check size={16} aria-hidden />}
        </button>
        <button
          type="button"
          className="app-icon-button h-9 w-9"
          onClick={onCancel}
          disabled={updateCategory.isPending}
          aria-label={`Cancel editing ${category.name}`}
          title="Cancel"
        >
          <X size={16} aria-hidden />
        </button>
      </div>
    </form>
  )
}
