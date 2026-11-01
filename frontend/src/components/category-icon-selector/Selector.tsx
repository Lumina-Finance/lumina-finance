import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { motion, useReducedMotion } from 'motion/react'
import { applyEmojiPickerStyles } from '@/components/category-icon-selector/emojiPickerStyles'
import { DROPDOWN_RISE_DISTANCE, DROPDOWN_RISE_TRANSITION } from '@/components/dropdown/motion'
import {
  getCachedEmojiMartData,
  loadEmojiMartData,
  type EmojiMartData,
} from '@/components/category-icon-selector/emojiMartData'
import { LoadFailureNote } from '@/components/category-icon-selector/LoadFailureNote'
import { useMinimumVisibleFlag } from '@/hooks/useMinimumVisibleFlag'
import { LOADING_ANIMATION_MIN_MS } from '@/utils/timing'

type EmojiPickerPosition = {
  left: number
  maxHeight: number
  top: number
  width: number
}

interface CategoryIconSelectorProps {
  buttonClassName?: string
  categoryName: string

  // Id of the element that says why the icon is invalid, announced with the button while hasError is set
  errorId?: string
  hasError?: boolean
  id?: string
  modalFieldTabStop?: boolean
  onChange: (icon: string) => void
  pickerAnchor?: 'button' | 'row'
  pickerAnchorRef?: RefObject<HTMLElement | null>
  value: string
}

interface EmojiMartSelection {
  native?: string
}

const EMOJI_PICKER_GAP = 8
const EMOJI_PICKER_HEIGHT = 350
const EMOJI_PICKER_PADDING = 12
// Seven 32px cells, the scrollbar's gutter either side, the panel's inner padding and its border
const EMOJI_PICKER_WIDTH = 262
const LOAD_FAILURE_MESSAGE = 'Failed to load emoji picker.'

// The only two values the picker takes as bare RGB triplets, which a token can't give. Every surface,
// border and fill is restyled from tokens in emojiPickerStyles.ts instead
const EMOJI_MART_THEME = {
  light: { color: '28, 21, 16', accent: '155, 108, 44' },
  dark: { color: '236, 230, 218', accent: '201, 169, 106' },
} as const

let cachedEmojiMartPickerModule: typeof import('emoji-mart') | null = null

/**
 * Tracks theme class changes so the external emoji picker follows Lumina's active theme
 */
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

/**
 * Renders the shared category icon picker button and positions the emoji picker against the active row or button
 */
export default function CategoryIconSelector({
  buttonClassName = 'group flex h-9 w-9 items-center justify-center rounded-md border p-1 text-xl leading-none transition-colors hover:border-[var(--app-border-strong)] app-field-focus-visible',
  categoryName,
  errorId,
  hasError = false,
  id,
  modalFieldTabStop = false,
  onChange,
  pickerAnchor = 'button',
  pickerAnchorRef,
  value,
}: CategoryIconSelectorProps) {
  const [open, setOpen] = useState(false)
  const [pickerPosition, setPickerPosition] = useState<EmojiPickerPosition | null>(null)
  const [loadFailure, setLoadFailure] = useState<string | null>(null)
  const selectorRef = useRef<HTMLDivElement | null>(null)

  // A failed emoji download closes the picker and leaves its reason in the page's flow instead
  const showLoadFailure = useCallback((message: string) => {
    setLoadFailure(message)
    setOpen(false)
    setPickerPosition(null)
  }, [])

  useEffect(() => {
    if (!loadFailure) return
    const dismiss = (event: PointerEvent) => {
      if (!selectorRef.current?.contains(event.target as Node)) setLoadFailure(null)
    }
    window.addEventListener('pointerdown', dismiss)
    return () => window.removeEventListener('pointerdown', dismiss)
  }, [loadFailure])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (selectorRef.current?.contains(event.target as Node)) return
      if (
        event.composedPath().some((node) => node instanceof HTMLElement && node.dataset.categoryEmojiPicker === 'true')
      )
        return
      setOpen(false)
      setPickerPosition(null)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  useEffect(() => {
    if (!open) return

    const updatePosition = () => {
      const selector = selectorRef.current
      if (!selector) return

      const anchor =
        pickerAnchorRef?.current ?? (pickerAnchor === 'row' ? (selector.closest('form') ?? selector) : selector)
      const rect = selector.getBoundingClientRect()
      const anchorRect = anchor.getBoundingClientRect()
      const visualViewport = window.visualViewport
      const viewportTop = visualViewport?.offsetTop ?? 0
      const viewportLeft = visualViewport?.offsetLeft ?? 0
      const viewportWidth = visualViewport?.width ?? window.innerWidth
      const viewportHeight = visualViewport?.height ?? window.innerHeight
      const viewportBottom = viewportTop + viewportHeight
      const viewportRight = viewportLeft + viewportWidth
      const width = Math.min(EMOJI_PICKER_WIDTH, viewportWidth - EMOJI_PICKER_PADDING * 2)
      const spaceBelow = viewportBottom - anchorRect.bottom - EMOJI_PICKER_GAP - EMOJI_PICKER_PADDING
      const spaceAbove = anchorRect.top - viewportTop - EMOJI_PICKER_GAP - EMOJI_PICKER_PADDING
      const openAbove = spaceBelow < 220 && spaceAbove > spaceBelow
      const availableHeight = Math.max(180, openAbove ? spaceAbove : spaceBelow)
      const maxHeight = Math.min(EMOJI_PICKER_HEIGHT, availableHeight, viewportHeight - EMOJI_PICKER_PADDING * 2)
      const top = openAbove
        ? Math.max(viewportTop + EMOJI_PICKER_PADDING, anchorRect.top - maxHeight - EMOJI_PICKER_GAP)
        : Math.min(anchorRect.bottom + EMOJI_PICKER_GAP, viewportBottom - maxHeight - EMOJI_PICKER_PADDING)
      const preferredLeft = pickerAnchor === 'row' ? anchorRect.left : rect.left
      const left = Math.min(
        Math.max(preferredLeft, viewportLeft + EMOJI_PICKER_PADDING),
        viewportRight - width - EMOJI_PICKER_PADDING,
      )

      setPickerPosition({ left, maxHeight, top, width })
    }

    const frame = window.requestAnimationFrame(updatePosition)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    window.visualViewport?.addEventListener('resize', updatePosition)
    window.visualViewport?.addEventListener('scroll', updatePosition)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      window.visualViewport?.removeEventListener('resize', updatePosition)
      window.visualViewport?.removeEventListener('scroll', updatePosition)
    }
  }, [open, pickerAnchor, pickerAnchorRef])

  return (
    <div ref={selectorRef} className="relative shrink-0">
      <button
        id={id}
        data-modal-field-tab-stop={modalFieldTabStop ? 'true' : undefined}
        type="button"
        className={buttonClassName}
        style={{
          background: hasError ? 'var(--app-negative-soft)' : 'var(--app-input-bg)',
          borderColor: hasError ? 'var(--app-negative-border)' : 'var(--app-input-border)',
        }}
        onClick={() => {
          setLoadFailure(null)
          setPickerPosition(null)
          setOpen((current) => !current)
        }}
        aria-label={`Select ${categoryName} icon`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-invalid={hasError || undefined}
        aria-describedby={hasError ? errorId : undefined}
      >
        <span className="translate-x-px" aria-hidden>
          {value}
        </span>
      </button>

      {open && pickerPosition && (
        <EmojiMartIconPicker
          categoryName={categoryName}
          onChange={onChange}
          onClose={() => {
            setOpen(false)
            setPickerPosition(null)
          }}
          onLoadFailure={showLoadFailure}
          position={pickerPosition}
        />
      )}
      {loadFailure && <LoadFailureNote message={loadFailure} />}
    </div>
  )
}

/**
 * Hosts the third-party emoji picker in a portal so row overflow and modal clipping do not hide the picker
 */
function EmojiMartIconPicker({
  categoryName,
  onChange,
  onClose,
  onLoadFailure,
  position,
}: {
  categoryName: string
  onChange: (icon: string) => void
  onClose: () => void
  onLoadFailure: (message: string) => void
  position: EmojiPickerPosition
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [data, setData] = useState<EmojiMartData | null>(getCachedEmojiMartData)
  const [pickerModule, setPickerModule] = useState<typeof import('emoji-mart') | null>(cachedEmojiMartPickerModule)
  const isDark = useAppDarkMode()
  const shouldReduceMotion = useReducedMotion()
  const loadingVisible = useMinimumVisibleFlag(data === null || pickerModule === null, LOADING_ANIMATION_MIN_MS)

  useEffect(() => {
    let cancelled = false
    loadEmojiMartData()
      .then((loadedData) => {
        if (!cancelled) setData(loadedData)
      })
      .catch((error) => {
        if (!cancelled) onLoadFailure(error instanceof Error ? error.message : LOAD_FAILURE_MESSAGE)
      })
    return () => {
      cancelled = true
    }
  }, [onLoadFailure])

  useEffect(() => {
    let cancelled = false
    // Load the picker on demand alongside its dataset so the loading state covers both requests
    import('emoji-mart')
      .then((module) => {
        cachedEmojiMartPickerModule = module
        if (!cancelled) setPickerModule(module)
      })
      .catch(() => {
        if (!cancelled) onLoadFailure(LOAD_FAILURE_MESSAGE)
      })
    return () => {
      cancelled = true
    }
  }, [onLoadFailure])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container || !data || !pickerModule || loadingVisible) return

    container.innerHTML = ''
    const picker = new pickerModule.Picker({
      data,
      autoFocus: false,
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
    pickerElement.style.setProperty('--font-family', '"DM Sans Variable", system-ui, sans-serif')
    pickerElement.style.setProperty('--font-size', '14px')
    pickerElement.style.setProperty('--border-radius', '0.75rem')
    pickerElement.style.setProperty('--shadow', 'none')
    pickerElement.style.setProperty('--sidebar-width', '8px')
    pickerElement.style.setProperty('--rgb-color', theme.color)
    pickerElement.style.setProperty('--rgb-accent', theme.accent)
    pickerElement.style.height = `${Math.max(position.maxHeight - 14, 220)}px`
    applyEmojiPickerStyles(pickerElement)
    container.appendChild(pickerElement)

    return () => {
      pickerElement.remove()
      container.innerHTML = ''
    }
  }, [data, isDark, loadingVisible, onChange, onClose, pickerModule, position.maxHeight])

  return createPortal(
    <motion.div
      className="fixed z-popover inline-block"
      data-category-emoji-picker="true"
      role="dialog"
      aria-label={`Select ${categoryName} icon`}
      // Rises and fades in on the dropdown's own contents motion, once, and not at all under reduced motion
      initial={shouldReduceMotion ? false : { opacity: 0, y: DROPDOWN_RISE_DISTANCE }}
      animate={{ opacity: 1, y: 0 }}
      transition={DROPDOWN_RISE_TRANSITION}
      style={{
        // The surface of .app-dropdown-glass-floating: solid input background, strong hairline, the
        // dropdown corner, the soft shadow and the inner padding its list sits in. Solid, since the
        // grid is dense enough that anything showing through it would cost legibility
        background: 'var(--app-input-bg)',
        border: '1px solid var(--app-border-strong)',
        borderRadius: 'var(--app-dropdown-radius)',
        boxShadow: 'var(--app-shadow-soft)',
        left: position.left,
        maxHeight: position.maxHeight,
        padding: 'var(--app-dropdown-inner-padding)',
        top: position.top,
        width: position.width,
      }}
    >
      {loadingVisible ? (
        <div className="flex h-20 items-center justify-center">
          <div className="app-spinner" aria-label="Loading emoji picker" />
        </div>
      ) : (
        <div ref={containerRef} />
      )}
    </motion.div>,
    document.body,
  )
}
