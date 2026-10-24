import { useState, type FormEvent } from 'react'
import { Tag as TagIcon } from 'lucide-react'
import { ApiError } from '@/api/auth'
import { useCreateTag, type Tag } from '@/api/tags'
import CreateModalSectionFrame from '@/components/create-modal/SectionFrame'
import CreateModalSectionHeadingRow from '@/components/create-modal/SectionHeadingRow'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import { ModalFormFooter } from '@/components/modal/FormFooter'
import type { ModalLevel } from '@/components/modal/Shell'
import { CREATE_TAG_FIELD_IDS, CREATE_TAG_NAME_REQUIRED_MESSAGE } from '@/components/reference-modals/createTagConstants'
import { LOADING_ANIMATION_MIN_MS, waitForMilliseconds } from '@/utils/timing'


interface CreateTagModalProps {
  open: boolean
  groupId?: string | null
  initialName?: string
  /** Set to stacked where this opens from inside another modal's picker */
  level?: ModalLevel
  onClose: () => void
  onCreated: (tag: Tag) => void
}

/**
 * Modal for creating a new tag, collecting its name before handing the created tag back through
 * `onCreated`
 *
 * At the stacked level it renders as the compact inline form used when creating a tag from inside another
 * reference picker, and at the page level as the standalone modal. Submission enforces a minimum
 * loading duration so the success state does not flash by unnoticed on fast responses
 */
export default function CreateTagModal({
  open,
  groupId = null,
  initialName = '',
  level = 'page',
  onClose,
  onCreated,
}: CreateTagModalProps) {
  const createTag = useCreateTag()
  const [name, setName] = useState(initialName)
  const [nameError, setNameError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [createInProgress, setCreateInProgress] = useState(false)
  const isSubmitting = createTag.isPending || createInProgress
  const isSecondary = level === 'stacked'

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSubmitting) return

    const trimmed = name.trim()
    if (!trimmed) {
      setNameError(CREATE_TAG_NAME_REQUIRED_MESSAGE)
      return
    }

    setCreateInProgress(true)
    const minimumLoading = waitForMilliseconds(LOADING_ANIMATION_MIN_MS)

    void createTag.mutateAsync({ name: trimmed, group_id: groupId })
      .then(async (tag) => {
        await minimumLoading
        onCreated(tag)
      })
      .catch(async (error) => {
        await minimumLoading
        // A name already taken is about the field, anything else about the request
        if (error instanceof ApiError && error.status === 409) setNameError(error.message)
        else setFormError(error instanceof ApiError ? error.message : 'Failed to create tag.')
        setCreateInProgress(false)
      })
  }

  const railLabel = isSecondary ? 'Linked' : 'Tag'
  const eyebrow = isSecondary ? 'Transaction setup' : 'New transaction tag'
  const title = isSecondary ? 'Add tag' : 'Create tag'
  const submitLabel = isSecondary ? 'Create' : 'Create'
  const submitWidth = isSecondary ? 'w-full sm:w-32' : 'w-full sm:w-28'

  return (
    <ModalTitledPanel
      open={open}
      level={level}
      titleId="create-tag-title"
      eyebrow={eyebrow}
      title={title}
      railLabel={railLabel}
      RailIcon={TagIcon}
      closeDisabled={isSubmitting}
      onClose={onClose}
      onSubmit={handleSubmit}
      footer={
        <ModalFormFooter
          submitLabel={submitLabel}
          submitDisabled={isSubmitting}
          submitWidthClassName={submitWidth}
          error={formError}
          level={level}
          onCancel={onClose}
        />
      }
    >
      <CreateModalSectionFrame step="01">
        <div className="min-w-0 space-y-3">
          <CreateModalSectionHeadingRow label="Tag name" error={nameError} errorId={CREATE_TAG_FIELD_IDS.nameError} />
          <div>
            <label htmlFor={CREATE_TAG_FIELD_IDS.name} className="sr-only">Tag name</label>
            <input
              id={CREATE_TAG_FIELD_IDS.name}
              className={`app-input ${nameError ? 'app-input-error' : ''}`}
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? CREATE_TAG_FIELD_IDS.nameError : undefined}
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                setNameError(null)
                setFormError(null)
              }}
              maxLength={64}
              required
            />
          </div>
        </div>
      </CreateModalSectionFrame>
    </ModalTitledPanel>
  )
}
