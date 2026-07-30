import { useState, type FormEvent } from 'react'
import { Tag as TagIcon } from 'lucide-react'
import { ApiError } from '@/api/auth'
import { useCreateTag, type Tag } from '@/api/tags'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import { ModalFormFooter } from '@/components/modal/FormFooter'
import { CREATE_TAG_MIN_LOADING_MS } from '@/pages/settings/components/tag-settings-section/constants'
import { waitForMilliseconds } from '@/utils/timing'

/**
 * Modal for creating a new tag, keeping the spinner visible for a minimum duration so a fast
 * create does not flash
 */
export default function TagCreateModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (tag: Tag) => void
}) {
  const createTag = useCreateTag()
  const [name, setName] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [createInProgress, setCreateInProgress] = useState(false)
  const isSubmitting = createTag.isPending || createInProgress


  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSubmitting) return

    const trimmed = name.trim()
    if (!trimmed) {
      setFormError('Name is required.')
      return
    }

    setCreateInProgress(true)
    const minimumLoading = waitForMilliseconds(CREATE_TAG_MIN_LOADING_MS)

    void createTag.mutateAsync({ name: trimmed })
      .then(async (tag) => {
        await minimumLoading
        onCreated(tag)
      })
      .catch(async (error) => {
        await minimumLoading
        setFormError(error instanceof ApiError ? error.message : 'Failed to create tag.')
        setCreateInProgress(false)
      })
  }

  return (
    <ModalTitledPanel
      open={open}
      onClose={onClose}
      onSubmit={handleSubmit}
      titleId="create-tag-title"
      title="Create Tag"
      eyebrow="New transaction tag"
      RailIcon={TagIcon}
      railLabel="Tag"
      closeDisabled={isSubmitting}
      footer={(
        <ModalFormFooter
          submitLabel="Create"
          submitDisabled={isSubmitting}
          submitWidthClassName="w-full sm:w-28"
          error={formError}
          onCancel={onClose}
        />
      )}
    >
      <section className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-2 min-[1050px]:gap-x-3">
        <div className="flex min-h-0 flex-col items-center">
          <span className="flex h-4 shrink-0 items-center text-xs font-semibold leading-none" style={{ color: 'var(--app-accent)' }} aria-hidden>
            01
          </span>
          <span
            className="mt-1 w-px flex-1"
            style={{ backgroundColor: 'var(--app-border-strong)' }}
            aria-hidden
          />
        </div>

        <div className="min-w-0 space-y-3">
          <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>
            Tag Name
          </p>
          <div>
            <input
              id="create-tag-name"
              className="app-input"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                setFormError(null)
              }}
              maxLength={64}
              required
            />
          </div>
        </div>
      </section>
    </ModalTitledPanel>
  )
}
