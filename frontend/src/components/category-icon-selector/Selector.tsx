import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, animate, motion, useIsPresent, useMotionValue, useReducedMotion } from 'motion/react'
import { applyEmojiPickerStyles } from '@/components/category-icon-selector/emojiPickerStyles'
import {
  EMOJI_PICKER_EASE_TRANSITION,
  getEmojiPickerPanelHeight,
  getEmojiPickerPlacement,
  getEmojiPickerWidth,
  measureScrollbarGutter,
  observePickerContent,
  type EmojiPickerPlacement,
} from '@/components/category-icon-selector/layout'
import {
  DROPDOWN_INSTANT_TRANSITION,
  DROPDOWN_NARROW_TRANSITION,
  DROPDOWN_RISE_DISTANCE,
  DROPDOWN_RISE_TRANSITION,
  DROPDOWN_SINK_TRANSITION,
} from '@/components/dropdown/motion'
import { FLOATING_LAYER_PROPS } from '@/utils/floatingLayer'
import {
  getCachedEmojiMartData,
  loadEmojiMartData,
  type EmojiMartData,
} from '@/components/category-icon-selector/emojiMartData'
import { LoadFailureNote } from '@/components/category-icon-selector/LoadFailureNote'
import { useMinimumVisibleFlag } from '@/hooks/useMinimumVisibleFlag'
import { LOADING_ANIMATION_MIN_MS } from '@/utils/timing'

type EmojiPickerPosition = EmojiPickerPlacement

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

  const closePicker = useCallback(() => {
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
      const viewport = {
        height: visualViewport?.height ?? window.innerHeight,
        layoutHeight: window.innerHeight,
        offsetLeft: visualViewport?.offsetLeft ?? 0,
        offsetTop: visualViewport?.offsetTop ?? 0,
        width: visualViewport?.width ?? window.innerWidth,
      }

      setPickerPosition(
        getEmojiPickerPlacement({
          anchorRect,
          preferredLeft: pickerAnchor === 'row' ? anchorRect.left : rect.left,
          viewport,
          width: getEmojiPickerWidth(measureScrollbarGutter(), viewport.width),
        }),
      )
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

      {/* Held in the page while it sinks away, which is why it is not simply left out when closed */}
      <AnimatePresence>
        {open && pickerPosition && (
          <EmojiMartIconPicker
            key="picker"
            categoryName={categoryName}
            onChange={onChange}
            onClose={closePicker}
            onLoadFailure={showLoadFailure}
            position={pickerPosition}
          />
        )}
      </AnimatePresence>
      {loadFailure && <LoadFailureNote message={loadFailure} />}
    </div>
  )
}

/**
 * Hosts the third-party emoji picker in a portal so row overflow and modal clipping do not hide the picker
 *
 * The panel's height is its own to follow the picker's contents, up to the Dropdown's greatest, and
 * eases when they change. While the picker downloads, the panel already stands at the size the
 * picker will arrive in, so loading in changes nothing but what is drawn inside it.
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
  const isPresent = useIsPresent()
  const shouldReduceMotion = useReducedMotion()
  const loadingVisible = useMinimumVisibleFlag(data === null || pickerModule === null, LOADING_ANIMATION_MIN_MS)
  const ready = data !== null && pickerModule !== null && !loadingVisible
  // A picker opened with everything already downloaded has nothing to ease in
  const [startedReady] = useState(ready)

  // The picker is built once per dataset and theme, so what it calls is read at the time of the call.
  // Otherwise every render of the form behind it would build it again, on top of a search in progress
  const onChangeRef = useRef(onChange)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onChangeRef.current = onChange
    onCloseRef.current = onClose
  })

  const fade = shouldReduceMotion ? DROPDOWN_INSTANT_TRANSITION : EMOJI_PICKER_EASE_TRANSITION
  const panelHeight = useMotionValue(position.maxHeight)
  const maxHeightRef = useRef(position.maxHeight)
  const contentHeightRef = useRef<number | null>(null)

  // Until the picker reports what it holds the panel stands at its greatest height, which is also
  // what the full list asks for, so the picker arrives into a panel that is already its size
  const followContent = useCallback(() => {
    const content = contentHeightRef.current
    const target = content === null ? maxHeightRef.current : getEmojiPickerPanelHeight(content, maxHeightRef.current)
    if (shouldReduceMotion || content === null) panelHeight.set(target)
    else animate(panelHeight, target, EMOJI_PICKER_EASE_TRANSITION)
  }, [panelHeight, shouldReduceMotion])

  useEffect(() => {
    maxHeightRef.current = position.maxHeight
    followContent()
  }, [followContent, position.maxHeight])

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
    // A panel already sinking away has been dismissed, so a second press has nothing left to close
    if (!isPresent) return
    // Heard on the way down, before the picker's own search field can take the key to clear itself,
    // so Escape dismisses the panel from wherever focus sits, as it does the dropdown
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onCloseRef.current()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [isPresent])

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
        onChangeRef.current(selection.native)
        onCloseRef.current()
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
    // Fills the panel, whatever height the panel is easing through, with the results scrolling inside
    pickerElement.style.height = '100%'
    pickerElement.style.minHeight = '0'
    pickerElement.style.setProperty('--font-family', '"DM Sans Variable", system-ui, sans-serif')
    pickerElement.style.setProperty('--font-size', '14px')
    pickerElement.style.setProperty('--border-radius', '0.75rem')
    pickerElement.style.setProperty('--shadow', 'none')
    pickerElement.style.setProperty('--sidebar-width', '8px')
    pickerElement.style.setProperty('--rgb-color', theme.color)
    pickerElement.style.setProperty('--rgb-accent', theme.accent)
    pickerElement.style.setProperty('--emoji-gutter', `${measureScrollbarGutter()}px`)
    applyEmojiPickerStyles(pickerElement)
    container.appendChild(pickerElement)
    const stopFollowing = observePickerContent(pickerElement, (contentHeight) => {
      contentHeightRef.current = contentHeight
      followContent()
    })

    return () => {
      stopFollowing()
      contentHeightRef.current = null
      pickerElement.remove()
      container.innerHTML = ''
    }
  }, [data, followContent, isDark, loadingVisible, pickerModule])

  return createPortal(
    <motion.div
      {...FLOATING_LAYER_PROPS}
      className="fixed z-popover"
      data-category-emoji-picker="true"
      role="dialog"
      aria-label={`Select ${categoryName} icon`}
      // Rises and fades in on the dropdown's own contents motion, once, and not at all under reduced motion
      initial={shouldReduceMotion ? false : { opacity: 0, y: DROPDOWN_RISE_DISTANCE }}
      animate={{ opacity: 1, y: 0 }}
      // Leaves the way the dropdown does: the contents sink and fade on its closing timing while the
      // box folds away on its own height's closing timing and curve
      exit={
        shouldReduceMotion
          ? undefined
          : {
              opacity: 0,
              y: DROPDOWN_RISE_DISTANCE,
              height: 0,
              transition: { ...DROPDOWN_SINK_TRANSITION, height: DROPDOWN_NARROW_TRANSITION },
            }
      }
      transition={DROPDOWN_RISE_TRANSITION}
      style={{
        // The surface of .app-dropdown-glass-floating: solid input background, strong hairline, the
        // dropdown corner and the soft shadow. Solid, since the grid is dense enough that anything
        // showing through it would cost legibility. The padding is inside, since a box folding to
        // nothing leaves its own padding behind
        background: 'var(--app-input-bg)',
        border: '1px solid var(--app-border-strong)',
        borderRadius: 'var(--app-dropdown-radius)',
        boxShadow: 'var(--app-shadow-soft)',
        bottom: position.bottom,
        height: panelHeight,
        left: position.left,
        maxHeight: position.maxHeight,
        overflow: 'hidden',
        // Nothing behind a panel on its way out should be reachable through it
        pointerEvents: isPresent ? undefined : 'none',
        top: position.top,
        width: position.width,
      }}
    >
      <div className="relative h-full" style={{ padding: 'var(--app-dropdown-inner-padding)' }}>
        <AnimatePresence>
          {!ready && (
            <motion.div
              key="loading"
              className="absolute inset-0 flex items-center justify-center"
              style={{ pointerEvents: 'none' }}
              initial={false}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={fade}
            >
              <div className="app-spinner" aria-label="Loading emoji picker" />
            </motion.div>
          )}
        </AnimatePresence>
        <motion.div
          ref={containerRef}
          className="h-full"
          initial={startedReady || shouldReduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: ready ? 1 : 0 }}
          transition={fade}
        />
      </div>
    </motion.div>,
    document.body,
  )
}
