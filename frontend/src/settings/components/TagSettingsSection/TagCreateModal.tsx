import { useEffect, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Tag as TagIcon, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { ApiError } from '@/api/auth'
import { useCreateTag, type Tag } from '@/api/tags'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import {
  CREATE_TAG_MIN_LOADING_MS,
  EASE,
} from '@/settings/components/TagSettingsSection/tagSettingsConstants'
import { waitForMilliseconds } from '@/utils/timing'

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

  useBodyScrollLock(open)

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

  return createPortal(
    <AnimatePresence>
      {open && [
          <motion.div
            key="create-tag-backdrop"
            className="fixed inset-0 z-50"
            style={{ background: 'rgba(0, 0, 0, 0.35)', backdropFilter: 'blur(4px)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={isSubmitting ? undefined : onClose}
            aria-hidden
          />,

          <motion.div
            key="create-tag-panel"
            className="fixed inset-0 z-[60] flex items-center justify-center p-4"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.25, ease: EASE }}
            onClick={isSubmitting ? undefined : onClose}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="create-tag-title"
              className="app-modal-panel flex max-h-[86vh] w-full max-w-2xl overflow-hidden rounded-2xl"
              style={{
                background: 'var(--app-bg)',
                border: '1px solid var(--app-border-strong)',
                boxShadow: 'var(--app-shadow-soft)',
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div
                className="hidden w-16 shrink-0 flex-col items-center justify-between py-6 sm:flex"
                style={{
                  background: 'var(--app-button-primary-bg)',
                  color: 'var(--app-button-primary-text)',
                }}
                aria-hidden
              >
                <TagIcon size={20} strokeWidth={2} />
                <span className="rotate-180 text-xs font-semibold uppercase" style={{ writingMode: 'vertical-rl' }}>
                  Tag
                </span>
              </div>

              <form className="flex min-h-0 w-full flex-col" onSubmit={handleSubmit} noValidate>
                <div className="shrink-0 pb-5 pl-4 pr-5 pt-6 sm:pt-7 min-[1050px]:px-8" style={{ borderBottom: '1px solid var(--app-border)' }}>
                  <div className="flex items-start justify-between gap-6">
                    <div className="min-w-0">
                      <p className="mb-2 text-xs font-semibold uppercase" style={{ color: 'var(--app-accent)' }}>
                        New transaction tag
                      </p>
                      <h3 id="create-tag-title" className="font-serif text-3xl font-light">
                        Create Tag
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

                <div className="min-h-0 flex-1 overflow-y-auto pb-3 pl-4 pr-5 pt-4 min-[1050px]:px-8">
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
                </div>

                <div
                  className="grid shrink-0 grid-cols-2 items-center gap-3 px-6 py-4 sm:flex sm:justify-end sm:px-8 min-[1050px]:py-5"
                  style={{ borderTop: '1px solid var(--app-border)' }}
                >
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
                    className={`app-primary-button overflow-hidden whitespace-nowrap duration-300 ${isSubmitting ? 'app-primary-button-loading justify-self-center sm:justify-self-auto' : 'w-full sm:w-28'}`}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <div className="app-spinner" aria-label="Creating" />
                    ) : (
                      'Create'
                    )}
                  </button>
                </div>
              </form>
            </div>
          </motion.div>,
      ]}
    </AnimatePresence>,
    document.body,
  )
}
