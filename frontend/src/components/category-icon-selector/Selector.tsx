import { useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Picker } from 'emoji-mart'

type EmojiPickerPosition = {
  left: number
  maxHeight: number
  top: number
  width: number
}

interface CategoryIconSelectorProps {
  buttonClassName?: string
  categoryName: string
  hasError?: boolean
  onChange: (icon: string) => void
  pickerAnchor?: 'button' | 'row'
  pickerAnchorRef?: RefObject<HTMLElement | null>
  value: string
}

interface EmojiMartData {
  emojis?: Record<string, unknown>
}

interface EmojiMartSelection {
  native?: string
}

const EMOJI_MART_DATA_URL = 'https://cdn.jsdelivr.net/npm/@emoji-mart/data'
const EMOJI_PICKER_GAP = 8
const EMOJI_PICKER_HEIGHT = 350
const EMOJI_PICKER_PADDING = 12
const EMOJI_PICKER_WIDTH = 280

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

/**
 * Loads the large emoji dataset once because multiple icon selectors can open during settings edits
 */
function loadEmojiMartData(): Promise<EmojiMartData> {
  if (!emojiMartDataPromise) {
    emojiMartDataPromise = fetch(EMOJI_MART_DATA_URL).then((response) => {
      if (!response.ok) throw new Error('Failed to load emoji data.')
      return response.json() as Promise<EmojiMartData>
    })
  }

  return emojiMartDataPromise
}

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
  buttonClassName = 'group flex h-9 w-9 items-center justify-center rounded-md border p-1 text-xl leading-none transition-colors duration-150 hover:border-[var(--app-border-strong)] focus-visible:border-[var(--app-accent-border)] focus-visible:outline-none',
  categoryName,
  hasError = false,
  onChange,
  pickerAnchor = 'button',
  pickerAnchorRef,
  value,
}: CategoryIconSelectorProps) {
  const [open, setOpen] = useState(false)
  const [pickerPosition, setPickerPosition] = useState<EmojiPickerPosition | null>(null)
  const selectorRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (selectorRef.current?.contains(event.target as Node)) return
      if (event.composedPath().some((node) => node instanceof HTMLElement && node.dataset.categoryEmojiPicker === 'true')) return
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

      const anchor = pickerAnchorRef?.current ?? (pickerAnchor === 'row' ? selector.closest('form') ?? selector : selector)
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
        type="button"
        className={buttonClassName}
        style={{
          background: hasError ? 'var(--app-negative-soft)' : 'var(--app-input-bg)',
          borderColor: hasError ? 'var(--app-negative-border)' : 'var(--app-input-border)',
        }}
        onClick={() => {
          setPickerPosition(null)
          setOpen((current) => !current)
        }}
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
          onClose={() => {
            setOpen(false)
            setPickerPosition(null)
          }}
          position={pickerPosition}
        />
      )}
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
