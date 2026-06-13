import { useState, type FormEvent } from 'react'
import { Check, Pencil, X } from 'lucide-react'
import { useUpdateMerchant, type Merchant } from '@/api/merchants'
import Dropdown, { type DropdownOption } from '@/components/Dropdown'
import { NO_CATEGORY_VALUE } from '@/pages/settings/components/merchant-settings-section/merchantSettingsConstants'
import { scopeLabel } from '@/pages/settings/components/merchant-settings-section/merchantSettingsUtils'

export default function InlineMerchantEdit({
  categoryOptions,
  isLast,
  merchant,
  onCancel,
}: {
  categoryOptions: DropdownOption[]
  isLast: boolean
  merchant: Merchant
  onCancel: () => void
}) {
  const updateMerchant = useUpdateMerchant()
  const [form, setForm] = useState({
    name: merchant.name,
    default_category_id: merchant.default_category_id ?? NO_CATEGORY_VALUE,
  })
  const [formError, setFormError] = useState<string | null>(null)

  const setField = <K extends keyof typeof form>(field: K, value: (typeof form)[K]) => {
    setForm((current) => ({ ...current, [field]: value }))
    setFormError(null)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (updateMerchant.isPending) return

    const name = form.name.trim()
    if (!name) {
      setFormError('Name is required.')
      return
    }

    const defaultCategoryId = form.default_category_id === NO_CATEGORY_VALUE ? null : form.default_category_id
    if (name === merchant.name && defaultCategoryId === merchant.default_category_id) {
      onCancel()
      return
    }

    updateMerchant.mutate(
      {
        merchantId: merchant.id,
        payload: {
          name,
          default_category_id: defaultCategoryId,
        },
      },
      {
        onSuccess: onCancel,
        onError: (error) => {
          setFormError(error instanceof Error ? error.message : 'Failed to update merchant.')
        },
      },
    )
  }

  return (
    <tr
      style={{ borderBottom: isLast ? 'none' : '1px solid var(--app-border)' }}
    >
      <td colSpan={3} className="py-2 pl-4 pr-4 align-top">
        <form
          className="grid min-h-10 grid-cols-[minmax(9rem,14rem)_minmax(0,1fr)_7rem] items-start gap-3"
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
                value={form.name}
                onChange={(event) => setField('name', event.target.value)}
                maxLength={256}
                aria-label={`${merchant.name} name`}
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
            <p className="mt-1 truncate text-xs" style={{ color: 'var(--app-text-muted)' }}>
              {scopeLabel(merchant)}
            </p>
          </div>
          <div className="min-w-0">
            <Dropdown
              className="h-9 w-full rounded-md border border-[var(--app-input-border)] bg-[var(--app-input-bg)] px-2 py-0 outline-none transition-colors duration-150 hover:border-[var(--app-border-strong)] focus:border-[var(--app-accent-border)]"
              options={categoryOptions}
              value={form.default_category_id}
              onChange={(value) => setField('default_category_id', value)}
              searchable
              searchPlaceholder="Search categories..."
            />
          </div>
          <div className="flex justify-end gap-1.5">
            <button
              type="submit"
              className="app-icon-button"
              disabled={updateMerchant.isPending}
              aria-label={`Save ${merchant.name}`}
              title="Save"
            >
              {updateMerchant.isPending ? <div className="app-spinner" aria-label="Saving" /> : <Check size={16} aria-hidden />}
            </button>
            <button
              type="button"
              className="app-icon-button"
              onClick={onCancel}
              disabled={updateMerchant.isPending}
              aria-label={`Cancel editing ${merchant.name}`}
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
