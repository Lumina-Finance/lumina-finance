import { useState, type FormEvent } from 'react'
import { Store } from 'lucide-react'
import { ApiError } from '@/api/auth'
import { useCreateMerchant, type Merchant } from '@/api/merchants'
import Dropdown, { type DropdownOption } from '@/components/dropdown/Dropdown'
import CreateModalSectionFrame from '@/components/create-modal/SectionFrame'
import CreateModalSectionHeadingRow from '@/components/create-modal/SectionHeadingRow'
import { FormError } from '@/components/forms/FormError'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import { ModalFormFooter } from '@/components/modal/FormFooter'
import type { ModalLevel } from '@/components/modal/Shell'
import {
  CREATE_MERCHANT_FIELD_IDS,
  CREATE_MERCHANT_FIELDS,
  CREATE_MERCHANT_NAME_REQUIRED_MESSAGE,
  NO_DEFAULT_CATEGORY_VALUE,
} from '@/components/reference-modals/createMerchantConstants'
import { useRefusedSubmit } from '@/hooks/useRefusedSubmit'
import { LOADING_ANIMATION_MIN_MS, waitForMilliseconds } from '@/utils/timing'

interface CreateMerchantModalProps {
  open: boolean
  categoryOptions: DropdownOption[]
  initialName?: string
  defaultCategoryValue?: string
  /** Set to stacked where this opens from inside another modal's picker */
  level?: ModalLevel
  onClose: () => void
  onCreated: (merchant: Merchant) => void
}

/**
 * Modal for creating a new merchant, collecting its name and an optional default category before
 * handing the created merchant back through `onCreated`
 *
 * At the stacked level it renders as the compact inline form used when creating a merchant from inside
 * another reference picker, and at the page level as the standalone modal. Submission enforces a
 * minimum loading duration so the success state does not flash by unnoticed on fast responses
 */
export default function CreateMerchantModal({
  open,
  categoryOptions,
  initialName = '',
  defaultCategoryValue = NO_DEFAULT_CATEGORY_VALUE,
  level = 'page',
  onClose,
  onCreated,
}: CreateMerchantModalProps) {
  const createMerchant = useCreateMerchant()
  const [form, setForm] = useState({
    name: initialName,
    default_category_id: defaultCategoryValue,
  })
  const [formError, setFormError] = useState<string | null>(null)
  const [createInProgress, setCreateInProgress] = useState(false)
  const isCreating = createMerchant.isPending || createInProgress
  const isSecondary = level === 'stacked'
  const name = form.name.trim()
  const refusal = useRefusedSubmit(
    { name: name ? undefined : CREATE_MERCHANT_NAME_REQUIRED_MESSAGE },
    CREATE_MERCHANT_FIELDS,
    CREATE_MERCHANT_FIELD_IDS,
  )
  const nameError = refusal.errors.name

  const setField = <K extends keyof typeof form>(field: K, value: (typeof form)[K]) => {
    setForm((current) => ({ ...current, [field]: value }))
    setFormError(null)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isCreating || !refusal.guard()) return

    setCreateInProgress(true)
    const minimumLoading = waitForMilliseconds(LOADING_ANIMATION_MIN_MS)

    void createMerchant.mutateAsync(
      {
        name,
        default_category_id: form.default_category_id === NO_DEFAULT_CATEGORY_VALUE ? null : form.default_category_id,
        group_id: null,
      },
    ).then(async (merchant) => {
      await minimumLoading
      onCreated(merchant)
    }).catch(async (error) => {
      await minimumLoading
      setFormError(error instanceof ApiError ? error.message : 'Failed to create merchant.')
      setCreateInProgress(false)
    })
  }

  const railLabel = isSecondary ? 'Linked' : 'Merchant'
  const eyebrow = isSecondary ? 'Transaction setup' : 'Personal merchant'
  const title = isSecondary ? 'Add merchant' : 'Create merchant'
  const submitLabel = isSecondary ? 'Create' : 'Create merchant'
  const submitWidth = isSecondary ? 'w-full sm:w-32' : 'w-full sm:w-40'

  return (
    <ModalTitledPanel
      open={open}
      level={level}
      titleId="create-merchant-title"
      eyebrow={eyebrow}
      title={title}
      railLabel={railLabel}
      RailIcon={Store}
      onClose={onClose}
      onSubmit={handleSubmit}
      footer={
        <ModalFormFooter
          submitLabel={submitLabel}
          submitDisabled={isCreating}
          submitBlockedReason={refusal.blockedReason}
          submitWidthClassName={submitWidth}
          level={level}
          onCancel={onClose}
        />
      }
    >
      <div className="space-y-5">
        <CreateModalSectionFrame step="01">
          <div className="min-w-0 space-y-3">
            <CreateModalSectionHeadingRow label="Merchant name" error={nameError} errorId={CREATE_MERCHANT_FIELD_IDS.nameError} />
            <div>
              <label htmlFor={CREATE_MERCHANT_FIELD_IDS.name} className="sr-only">Merchant name</label>
              <input
                id={CREATE_MERCHANT_FIELD_IDS.name}
                className={`app-input ${nameError ? 'app-input-error' : ''}`}
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameError ? CREATE_MERCHANT_FIELD_IDS.nameError : undefined}
                value={form.name}
                onChange={(event) => setField('name', event.target.value)}
                onBlur={() => refusal.touch('name')}
                placeholder="Costco"
                maxLength={256}
                required
              />
            </div>
          </div>
        </CreateModalSectionFrame>

        <CreateModalSectionFrame step="02">
          <div className="min-w-0 space-y-3">
            <div>
              <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>Default category</p>
              <p className="mt-2 text-sm leading-5" style={{ color: 'var(--app-text-muted)' }}>
                Used to prefill the category when this merchant is selected when creating a new transaction.
              </p>
            </div>
            <div>
              <label htmlFor={CREATE_MERCHANT_FIELD_IDS.defaultCategory} className="sr-only">Default category</label>
              <Dropdown
                id={CREATE_MERCHANT_FIELD_IDS.defaultCategory}
                options={categoryOptions}
                value={form.default_category_id}
                onChange={(value) => setField('default_category_id', value)}
                searchable
                searchPlaceholder="Search categories..."
              />
            </div>
          </div>
        </CreateModalSectionFrame>

        <FormError message={formError} />
      </div>
    </ModalTitledPanel>
  )
}
