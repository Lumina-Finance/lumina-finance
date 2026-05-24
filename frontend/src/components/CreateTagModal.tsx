import { useEffect, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Tag as TagIcon, X } from 'lucide-react'
import { ApiError } from '@/api/auth'
import { useCreateTag, type Tag } from '@/api/tags'

const EASE = [0.25, 0.1, 0.25, 1] as const
const CREATE_TAG_MIN_LOADING_MS = 800

type CreateTagModalVariant = 'primary' | 'secondary'

interface CreateTagModalProps {
  open: boolean
  groupId?: string | null
  initialName?: string
  variant?: CreateTagModalVariant
  onClose: () => void
  onCreated: (tag: Tag) => void
}

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

export default function CreateTagModal({
  open,
  groupId = null,
  initialName = '',
  variant = 'primary',
  onClose,
  onCreated,
}: CreateTagModalProps) {
  const createTag = useCreateTag()
  const [name, setName] = useState(initialName)
  const [formError, setFormError] = useState<string | null>(null)
  const [createInProgress, setCreateInProgress] = useState(false)
  const isSubmitting = createTag.isPending || createInProgress
  const isSecondary = variant === 'secondary'

  useEffect(() => {
    if (!open || isSecondary) return undefined

    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [isSecondary, open])

  useEffect(() => {
    if (!open) return undefined

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSubmitting) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isSubmitting, onClose, open])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSubmitting) return

    const trimmed = name.trim()
    if (!trimmed) {
      setFormError('Name is required.')
      return
    }

    setCreateInProgress(true)
    const minimumLoading = delay(CREATE_TAG_MIN_LOADING_MS)

    void createTag.mutateAsync({ name: trimmed, group_id: groupId })
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

  const backdropClassName = isSecondary ? 'fixed inset-0 z-[90]' : 'fixed inset-0 z-50'
  const backdropStyle = isSecondary
    ? { background: 'rgba(0, 0, 0, 0.22)', backdropFilter: 'blur(6px)' }
    : { background: 'rgba(0, 0, 0, 0.35)', backdropFilter: 'blur(4px)' }
  const panelClassName = isSecondary
    ? 'fixed inset-0 z-[100] flex items-center justify-center p-4'
    : 'fixed inset-0 z-[60] flex items-center justify-center p-4'
  const panelInitial = isSecondary ? { opacity: 0, scale: 0.94, y: 16 } : { opacity: 0, scale: 0.96, y: 12 }
  const panelTransition = isSecondary ? { duration: 0.22, ease: EASE } : { duration: 0.25, ease: EASE }
  const modalClassName = isSecondary
    ? 'app-modal-panel flex max-h-[84vh] w-full max-w-xl overflow-hidden rounded-2xl'
    : 'app-modal-panel flex max-h-[86vh] w-full max-w-2xl overflow-hidden rounded-2xl'
  const railClassName = isSecondary
    ? 'app-secondary-modal-rail hidden w-12 shrink-0 flex-col items-center justify-between py-5 sm:flex'
    : 'hidden w-16 shrink-0 flex-col items-center justify-between py-6 sm:flex'
  const railStyle = isSecondary
    ? {
        background: 'var(--app-surface-soft)',
        borderRight: '1px solid var(--app-border)',
        color: 'var(--app-accent)',
      }
    : {
        background: 'var(--app-button-primary-bg)',
        color: 'var(--app-button-primary-text)',
      }
  const railLabel = isSecondary ? 'Linked' : 'Tag'
  const headerPadding = isSecondary ? 'shrink-0 pb-5 pl-4 pr-5 pt-6 min-[1050px]:px-7' : 'shrink-0 pb-5 pl-4 pr-5 pt-6 sm:pt-7 min-[1050px]:px-8'
  const bodyPadding = isSecondary ? 'min-h-0 flex-1 overflow-y-auto pb-3 pl-4 pr-5 pt-4 min-[1050px]:px-7' : 'min-h-0 flex-1 overflow-y-auto pb-3 pl-4 pr-5 pt-4 min-[1050px]:px-8'
  const footerPadding = isSecondary ? 'grid shrink-0 grid-cols-2 items-center gap-3 px-6 py-5 sm:flex sm:justify-end sm:px-7' : 'grid shrink-0 grid-cols-2 items-center gap-3 px-6 py-5 sm:flex sm:justify-end sm:px-8'
  const eyebrow = isSecondary ? 'Transaction setup' : 'New transaction tag'
  const title = isSecondary ? 'Add Tag' : 'Create Tag'
  const submitLabel = isSecondary ? 'Create' : 'Create'
  const submitWidth = isSecondary ? 'w-full sm:w-32' : 'w-full sm:w-28'

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className={backdropClassName}
            style={backdropStyle}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: isSecondary ? 0.15 : 0.2 }}
            onClick={isSubmitting ? undefined : onClose}
            aria-hidden
          />

          <motion.div
            className={panelClassName}
            initial={panelInitial}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={panelInitial}
            transition={panelTransition}
            onClick={isSubmitting ? undefined : onClose}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="create-tag-title"
              className={modalClassName}
              style={{
                background: 'var(--app-bg)',
                border: '1px solid var(--app-border-strong)',
                boxShadow: 'var(--app-shadow-soft)',
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className={railClassName} style={railStyle} aria-hidden>
                <TagIcon size={isSecondary ? 18 : 20} strokeWidth={2} />
                <span className={`${isSecondary ? 'text-[0.6875rem]' : 'text-xs'} rotate-180 font-semibold uppercase`} style={{ writingMode: 'vertical-rl' }}>
                  {railLabel}
                </span>
              </div>

              <form className="flex min-h-0 w-full flex-col" onSubmit={handleSubmit} noValidate>
                <div className={headerPadding} style={{ borderBottom: '1px solid var(--app-border)' }}>
                  <div className="flex items-start justify-between gap-6">
                    <div className="min-w-0">
                      <p className="mb-2 text-xs font-semibold uppercase" style={{ color: 'var(--app-accent)' }}>
                        {eyebrow}
                      </p>
                      <h3 id="create-tag-title" className="font-serif text-3xl font-light">
                        {title}
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={onClose}
                      className="app-icon-button shrink-0"
                      disabled={isSubmitting}
                      aria-label="Close"
                    >
                      <X size={20} aria-hidden />
                    </button>
                  </div>
                </div>

                <div className={bodyPadding}>
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
                        <label htmlFor="create-tag-name" className="sr-only">Tag name</label>
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
                </div>

                <div className={footerPadding} style={{ borderTop: '1px solid var(--app-border)' }}>
                  {formError && (
                    <p className="col-span-2 text-sm font-medium sm:col-span-1 sm:mr-auto" style={{ color: 'var(--app-negative)' }}>
                      {formError}
                    </p>
                  )}
                  <button
                    type="button"
                    className="app-secondary-button w-full sm:w-auto"
                    onClick={onClose}
                    disabled={isSubmitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className={`app-primary-button overflow-hidden whitespace-nowrap duration-300 ${isSubmitting ? 'app-primary-button-loading justify-self-center sm:justify-self-auto' : submitWidth}`}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <div className="app-spinner" aria-label="Creating" />
                    ) : (
                      submitLabel
                    )}
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  )
}
