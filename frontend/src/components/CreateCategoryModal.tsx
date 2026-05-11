import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Picker } from 'emoji-mart'
import { AnimatePresence, motion } from 'motion/react'
import { Tag, X } from 'lucide-react'
import { useCreateCategory, type Category } from '@/api/categories'
import Dropdown from '@/components/Dropdown'

type CategoryKind = Category['kind']
type CreateCategoryField = 'icon' | 'name'
type CreateCategoryFieldErrors = Partial<Record<CreateCategoryField, string>>
type CreateCategoryModalVariant = 'primary' | 'secondary'
type EmojiPickerPosition = {
  left: number
  maxHeight: number
  top: number
  width: number
}

interface CreateCategoryModalProps {
  open: boolean
  initialKind?: CategoryKind
  initialName?: string
  variant?: CreateCategoryModalVariant
  onClose: () => void
  onCreated: (category: Category) => void
}

interface EmojiMartData {
  emojis?: Record<string, unknown>
}

interface EmojiMartSelection {
  native?: string
}

const EASE = [0.25, 0.1, 0.25, 1] as const
const CREATE_CATEGORY_MIN_LOADING_MS = 800
const EMOJI_MART_DATA_URL = 'https://cdn.jsdelivr.net/npm/@emoji-mart/data'
const EMOJI_PICKER_GAP = 8
const EMOJI_PICKER_HEIGHT = 350
const EMOJI_PICKER_PADDING = 12
const EMOJI_PICKER_WIDTH = 280

const KIND_LABELS: Record<CategoryKind, string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
}

const KIND_ORDER: CategoryKind[] = ['expense', 'income', 'transfer']
const KIND_OPTIONS = KIND_ORDER.map((kind) => ({ value: kind, label: KIND_LABELS[kind] }))

const EMOJI_MART_THEME = {
  light: {
    color: '28, 21, 16',
    accent: '155, 108, 44',
    background: '242, 237, 228',
    input: '255, 255, 255',
    border: 'rgba(75, 55, 35, 0.14)',
    borderOver: 'rgba(75, 55, 35, 0.24)',
  },
  dark: {
    color: '236, 230, 218',
    accent: '201, 169, 106',
    background: '15, 14, 12',
    input: '36, 31, 25',
    border: 'rgba(210, 180, 120, 0.12)',
    borderOver: 'rgba(210, 180, 120, 0.24)',
  },
} as const

let emojiMartDataPromise: Promise<EmojiMartData> | null = null

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function loadEmojiMartData(): Promise<EmojiMartData> {
  if (!emojiMartDataPromise) {
    emojiMartDataPromise = fetch(EMOJI_MART_DATA_URL).then((response) => {
      if (!response.ok) throw new Error('Failed to load emoji data.')
      return response.json() as Promise<EmojiMartData>
    })
  }
  return emojiMartDataPromise
}

function useAppDarkMode() {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => {
      setIsDark(root.classList.contains('dark'))
    })
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return isDark
}

export default function CreateCategoryModal({
  open,
  initialKind = 'expense',
  initialName = '',
  variant = 'primary',
  onClose,
  onCreated,
}: CreateCategoryModalProps) {
  const createCategory = useCreateCategory()
  const [form, setForm] = useState({
    name: initialName,
    kind: initialKind,
    icon: '',
  })
  const [fieldErrors, setFieldErrors] = useState<CreateCategoryFieldErrors>({})
  const [touched, setTouched] = useState<Record<CreateCategoryField, boolean>>({
    icon: false,
    name: false,
  })
  const [formError, setFormError] = useState<string | null>(null)
  const [createInProgress, setCreateInProgress] = useState(false)
  const isCreating = createCategory.isPending || createInProgress
  const isSecondary = variant === 'secondary'

  useEffect(() => {
    if (!open || isSecondary) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [isSecondary, open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const showError = (field: CreateCategoryField) => touched[field] && fieldErrors[field]
  const setField = <K extends keyof typeof form>(field: K, value: (typeof form)[K]) => {
    setForm((current) => ({ ...current, [field]: value }))
    if (field === 'icon' || field === 'name') {
      setTouched((current) => ({ ...current, [field]: true }))
      setFieldErrors((current) => ({ ...current, [field]: undefined }))
    }
    setFormError(null)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isCreating) return

    const name = form.name.trim()
    const nextErrors: CreateCategoryFieldErrors = {}
    if (!form.icon) nextErrors.icon = 'Required'
    if (!name) nextErrors.name = 'Name is required'
    if (Object.keys(nextErrors).length > 0) {
      setTouched({ icon: true, name: true })
      setFieldErrors(nextErrors)
      return
    }

    setCreateInProgress(true)
    const minimumLoading = delay(CREATE_CATEGORY_MIN_LOADING_MS)

    void createCategory.mutateAsync(
      {
        name,
        kind: form.kind,
        icon: form.icon,
        group_id: null,
      },
    ).then(async (category) => {
      await minimumLoading
      onCreated(category)
    }).catch(async (error) => {
      await minimumLoading
      setFormError(error instanceof Error ? error.message : 'Failed to create category.')
      setCreateInProgress(false)
    })
  }

  const backdropClassName = isSecondary ? 'fixed inset-0 z-[100]' : 'fixed inset-0 z-50'
  const backdropStyle = isSecondary
    ? { background: 'rgba(0, 0, 0, 0.22)', backdropFilter: 'blur(6px)' }
    : { background: 'rgba(0, 0, 0, 0.35)', backdropFilter: 'blur(4px)' }
  const panelClassName = isSecondary
    ? 'fixed inset-0 z-[100] flex items-center justify-center p-4'
    : 'fixed inset-0 z-50 flex items-center justify-center p-4'
  const panelInitial = isSecondary ? { opacity: 0, scale: 0.94, y: 16 } : { opacity: 0, scale: 0.96, y: 12 }
  const panelTransition = isSecondary ? { duration: 0.22, ease: EASE } : { duration: 0.25, ease: EASE }
  const modalClassName = isSecondary
    ? 'app-modal-panel flex max-h-[84vh] w-full max-w-xl rounded-2xl'
    : 'app-modal-panel flex max-h-[86vh] w-full max-w-2xl rounded-2xl'
  const railClassName = isSecondary
    ? 'app-secondary-modal-rail hidden w-12 shrink-0 flex-col items-center justify-between rounded-l-2xl py-5 sm:flex'
    : 'hidden w-16 shrink-0 flex-col items-center justify-between rounded-l-2xl py-6 sm:flex'
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
  const railLabel = isSecondary ? 'Linked' : 'Category'
  const headerPadding = isSecondary ? 'shrink-0 px-6 pb-5 pt-6 sm:px-7' : 'shrink-0 px-6 pb-5 pt-6 sm:px-8 sm:pt-7'
  const bodyPadding = isSecondary ? 'px-6 pb-3 pt-4 sm:px-7' : 'px-6 pb-3 pt-4 sm:px-8'
  const footerPadding = isSecondary ? 'flex shrink-0 flex-col-reverse gap-3 px-6 py-5 sm:flex-row sm:justify-end sm:px-7' : 'flex shrink-0 flex-col-reverse gap-3 px-6 py-5 sm:flex-row sm:justify-end sm:px-8'
  const eyebrow = isSecondary ? 'Transaction setup' : `${KIND_LABELS[form.kind]} category`
  const title = isSecondary ? 'Add Category' : 'Create Category'
  const submitLabel = isSecondary ? 'Create' : 'Create Category'
  const submitWidth = isSecondary ? 'w-full sm:w-32' : 'w-full sm:w-40'

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
            onClick={onClose}
            aria-hidden
          />

          <motion.div
            className={panelClassName}
            initial={panelInitial}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={panelInitial}
            transition={panelTransition}
            onClick={onClose}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="create-category-title"
              className={modalClassName}
              style={{
                background: 'var(--app-bg)',
                border: '1px solid var(--app-border-strong)',
                boxShadow: 'var(--app-shadow-soft)',
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className={railClassName} style={railStyle} aria-hidden>
                <Tag size={isSecondary ? 18 : 20} strokeWidth={2} />
                <span className={`${isSecondary ? 'text-[0.6875rem]' : 'text-xs'} rotate-180 font-semibold uppercase`} style={{ writingMode: 'vertical-rl' }}>
                  {railLabel}
                </span>
              </div>

              <form onSubmit={handleSubmit} className="flex min-h-0 w-full flex-col" noValidate>
                <div className={headerPadding} style={{ borderBottom: '1px solid var(--app-border)' }}>
                  <div className="flex items-start justify-between gap-6">
                    <div className="min-w-0">
                      <p className="mb-2 text-xs font-semibold uppercase" style={{ color: 'var(--app-accent)' }}>
                        {eyebrow}
                      </p>
                      <h3 id="create-category-title" className="font-serif text-3xl font-light">
                        {title}
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={onClose}
                      className="app-icon-button shrink-0"
                      aria-label="Close"
                    >
                      <X size={20} aria-hidden />
                    </button>
                  </div>
                </div>

                <div className={bodyPadding}>
                  <div className="space-y-5">
                    <section className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3">
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
                        <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>Identity</p>

                        <div className="grid gap-4 sm:grid-cols-[3.5rem_minmax(0,1fr)]">
                          <div>
                            <div className="mb-1.5 flex items-start justify-between gap-3">
                              <span className="app-label block shrink-0 text-[0.9375rem] leading-5">Icon</span>
                              <AnimatePresence initial={false}>
                                {showError('icon') && (
                                  <motion.p
                                    key="icon-error"
                                    className="text-right text-xs font-medium leading-5"
                                    style={{ color: 'var(--app-negative)' }}
                                    initial={{ opacity: 0, x: 4 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: 4 }}
                                    transition={{ duration: 0.15 }}
                                  >
                                    {fieldErrors.icon}
                                  </motion.p>
                                )}
                              </AnimatePresence>
                            </div>
                            <CategoryIconSelector
                              categoryName={form.name || 'New category'}
                              value={form.icon}
                              onChange={(icon) => setField('icon', icon)}
                              buttonClassName={`app-input flex h-10 w-10 items-center justify-center p-0 text-xl leading-none ${showError('icon') ? 'app-input-error' : ''}`}
                              hasError={!!showError('icon')}
                            />
                          </div>

                          <div>
                            <div className="mb-1.5 flex items-start justify-between gap-3">
                              <span className="app-label block shrink-0 text-[0.9375rem] leading-5">Category name</span>
                              <AnimatePresence initial={false}>
                                {showError('name') && (
                                  <motion.p
                                    key="name-error"
                                    className="text-right text-xs font-medium leading-5"
                                    style={{ color: 'var(--app-negative)' }}
                                    initial={{ opacity: 0, x: 4 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: 4 }}
                                    transition={{ duration: 0.15 }}
                                  >
                                    {fieldErrors.name}
                                  </motion.p>
                                )}
                              </AnimatePresence>
                            </div>
                            <input
                              className={`app-input ${showError('name') ? 'app-input-error' : ''}`}
                              value={form.name}
                              onChange={(event) => setField('name', event.target.value)}
                              onBlur={() => setTouched((current) => ({ ...current, name: true }))}
                              placeholder="Groceries"
                              maxLength={256}
                              required
                            />
                          </div>
                        </div>
                      </div>
                    </section>

                    <section className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3">
                      <div className="flex min-h-0 flex-col items-center">
                        <span className="flex h-4 shrink-0 items-center text-xs font-semibold leading-none" style={{ color: 'var(--app-accent)' }} aria-hidden>
                          02
                        </span>
                        <span
                          className="mt-1 w-px flex-1"
                          style={{ backgroundColor: 'var(--app-border-strong)' }}
                          aria-hidden
                        />
                      </div>

                      <div className="min-w-0 space-y-3">
                        <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>Classification</p>
                        <div>
                          <span className="app-label mb-1.5 block text-[0.9375rem] leading-5">Category type</span>
                          <Dropdown
                            options={KIND_OPTIONS}
                            value={form.kind}
                            onChange={(value) => setField('kind', value as CategoryKind)}
                          />
                        </div>
                      </div>
                    </section>

                    <AnimatePresence>
                      {formError && (
                        <motion.p
                          className="text-sm font-medium"
                          style={{ color: 'var(--app-negative)' }}
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          transition={{ duration: 0.15 }}
                        >
                          {formError}
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                <div className={footerPadding} style={{ borderTop: '1px solid var(--app-border)' }}>
                  <button type="button" className="app-secondary-button w-full sm:w-auto" onClick={onClose} disabled={isCreating}>
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className={`app-primary-button overflow-hidden whitespace-nowrap duration-300 ${isCreating ? 'app-primary-button-loading' : submitWidth}`}
                    disabled={isCreating}
                  >
                    {isCreating ? <div className="app-spinner" aria-label="Creating" /> : submitLabel}
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

export function CategoryIconSelector({
  buttonClassName = 'group flex h-9 w-9 items-center justify-center rounded-md border p-1 text-xl leading-none transition-colors duration-150 hover:border-[var(--app-border-strong)] focus-visible:border-[var(--app-accent-border)] focus-visible:outline-none',
  categoryName,
  hasError = false,
  onChange,
  pickerAnchor = 'button',
  value,
}: {
  buttonClassName?: string
  categoryName: string
  hasError?: boolean
  onChange: (icon: string) => void
  pickerAnchor?: 'button' | 'row'
  value: string
}) {
  const [open, setOpen] = useState(false)
  const [pickerPosition, setPickerPosition] = useState<EmojiPickerPosition | null>(null)
  const selectorRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (selectorRef.current?.contains(event.target as Node)) return
      if (event.composedPath().some((node) => node instanceof HTMLElement && node.dataset.categoryEmojiPicker === 'true')) return
      setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  useEffect(() => {
    if (!open) return

    const updatePosition = () => {
      const selector = selectorRef.current
      if (!selector) return

      const anchor = pickerAnchor === 'row' ? selector.closest('form') ?? selector : selector
      const rect = selector.getBoundingClientRect()
      const anchorRect = anchor.getBoundingClientRect()
      const width = Math.min(EMOJI_PICKER_WIDTH, window.innerWidth - EMOJI_PICKER_PADDING * 2)
      const spaceBelow = window.innerHeight - anchorRect.bottom - EMOJI_PICKER_GAP - EMOJI_PICKER_PADDING
      const spaceAbove = anchorRect.top - EMOJI_PICKER_GAP - EMOJI_PICKER_PADDING
      const openAbove = spaceBelow < 220 && spaceAbove > spaceBelow
      const availableHeight = Math.max(180, openAbove ? spaceAbove : spaceBelow)
      const maxHeight = Math.min(EMOJI_PICKER_HEIGHT, availableHeight, window.innerHeight - EMOJI_PICKER_PADDING * 2)
      const top = openAbove
        ? Math.max(EMOJI_PICKER_PADDING, anchorRect.top - maxHeight - EMOJI_PICKER_GAP)
        : Math.min(anchorRect.bottom + EMOJI_PICKER_GAP, window.innerHeight - maxHeight - EMOJI_PICKER_PADDING)
      const preferredLeft = pickerAnchor === 'row' ? anchorRect.left : rect.left
      const left = Math.min(
        Math.max(preferredLeft, EMOJI_PICKER_PADDING),
        window.innerWidth - width - EMOJI_PICKER_PADDING,
      )

      setPickerPosition({ left, maxHeight, top, width })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, pickerAnchor])

  return (
    <div ref={selectorRef} className="relative shrink-0">
      <button
        type="button"
        className={buttonClassName}
        style={{
          background: hasError ? 'var(--app-negative-soft)' : 'var(--app-input-bg)',
          borderColor: hasError ? 'var(--app-negative-border)' : 'var(--app-input-border)',
        }}
        onClick={() => setOpen((current) => !current)}
        aria-label={`Select ${categoryName} icon`}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span className="translate-x-px" aria-hidden>
          {value}
        </span>
      </button>

      {open && pickerPosition && (
        <EmojiMartIconPicker
          categoryName={categoryName}
          onChange={onChange}
          onClose={() => setOpen(false)}
          position={pickerPosition}
        />
      )}
    </div>
  )
}

function EmojiMartIconPicker({
  categoryName,
  onChange,
  onClose,
  position,
}: {
  categoryName: string
  onChange: (icon: string) => void
  onClose: () => void
  position: EmojiPickerPosition
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [data, setData] = useState<EmojiMartData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const isDark = useAppDarkMode()

  useEffect(() => {
    let cancelled = false
    loadEmojiMartData()
      .then((loadedData) => {
        if (!cancelled) setData(loadedData)
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Failed to load emoji picker.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !data) return

    container.innerHTML = ''
    const picker = new Picker({
      data,
      autoFocus: true,
      emojiButtonColors: ['var(--app-accent-soft)'],
      emojiButtonRadius: '6px',
      emojiButtonSize: 32,
      emojiSize: 20,
      emojiVersion: 14,
      icons: 'outline',
      maxFrequentRows: 0,
      navPosition: 'none',
      noCountryFlags: true,
      onEmojiSelect: (selection: EmojiMartSelection) => {
        if (!selection.native) return
        onChange(selection.native)
        onClose()
      },
      perLine: 7,
      previewPosition: 'none',
      searchPosition: 'sticky',
      set: 'native',
      skinTonePosition: 'none',
      theme: isDark ? 'dark' : 'light',
    })
    const pickerElement = picker as unknown as HTMLElement
    const theme = EMOJI_MART_THEME[isDark ? 'dark' : 'light']
    pickerElement.style.width = '100%'
    pickerElement.style.setProperty('--font-family', '"DM Sans", system-ui, sans-serif')
    pickerElement.style.setProperty('--font-size', '14px')
    pickerElement.style.setProperty('--border-radius', '0.75rem')
    pickerElement.style.setProperty('--shadow', 'none')
    pickerElement.style.setProperty('--sidebar-width', '8px')
    pickerElement.style.setProperty('--rgb-color', theme.color)
    pickerElement.style.setProperty('--rgb-accent', theme.accent)
    pickerElement.style.setProperty('--rgb-background', theme.background)
    pickerElement.style.setProperty('--rgb-input', theme.input)
    pickerElement.style.setProperty('--color-border', theme.border)
    pickerElement.style.setProperty('--color-border-over', theme.borderOver)
    pickerElement.style.height = `${Math.max(position.maxHeight - 14, 220)}px`
    container.appendChild(pickerElement)

    return () => {
      pickerElement.remove()
      container.innerHTML = ''
    }
  }, [data, isDark, onChange, onClose, position.maxHeight])

  return createPortal(
    <div
      className="fixed z-[110] inline-block rounded-xl pb-2 pl-1 pr-1 pt-1"
      data-category-emoji-picker="true"
      role="dialog"
      aria-label={`Select ${categoryName} icon`}
      style={{
        background: isDark ? 'rgb(15, 14, 12)' : 'rgb(242, 237, 228)',
        border: '1px solid var(--app-border-strong)',
        boxShadow: 'var(--app-shadow-soft)',
        left: position.left,
        maxHeight: position.maxHeight,
        top: position.top,
        width: position.width,
      }}
    >
      {loadError ? (
        <p className="p-2 text-sm" style={{ color: 'var(--app-negative)' }}>
          {loadError}
        </p>
      ) : !data ? (
        <div className="flex h-20 items-center justify-center">
          <div className="app-spinner" aria-label="Loading emoji picker" />
        </div>
      ) : (
        <div ref={containerRef} />
      )}
    </div>,
    document.body,
  )
}
