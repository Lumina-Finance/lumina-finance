import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Info, TriangleAlert, type LucideIcon } from 'lucide-react'
import { joinClassNames } from '@/utils/classNames'
import { FX_TONE_CLASS, type IconTooltipFxTone } from '@/components/tooltips/fxToneClass'
import {
  getIconTooltipOffset,
  getIconTooltipPlacement,
  getTooltipCoverBottom,
  type IconTooltipPlacement,
} from '@/utils/tooltipPosition'

export type IconTooltipLevel = 'info' | 'warn' | 'important'

type IconTooltipIcon = LucideIcon | 'fx'

interface IconTooltipProps {
  label: string
  children: ReactNode
  level?: IconTooltipLevel
  placement?: IconTooltipPlacement
  widthClassName?: string
  icon?: IconTooltipIcon
  iconColor?: string
  fxTone?: IconTooltipFxTone
  size?: number
  strokeWidth?: number

  // Makes the trigger a candidate for the modal's initial focus
  modalFieldTabStop?: boolean

  // Keeps controls in a closed tooltip out of the modal keyboard navigation
  interactive?: boolean

  // What limits the room above and below the trigger when picking a side: the nearest ancestor marked
  // with `data-tooltip-bounds`, or only the viewport, for a panel meant to rise over the edge of its box
  sideBoundary?: IconTooltipSideBoundary

  // Fills the icon on hover and while open, which suits the round info and help icons. An outline
  // icon such as a building would lose its strokes to the fill, so it opts out
  hoverFill?: boolean

  // Takes presses a few pixels around the icon too, making the 24px square WCAG asks of a small
  // target, for an icon in a surface that does something else on a press, where a near miss would
  // do that instead. The icon keeps its size and place
  widensHitArea?: boolean

  // Rings the trigger under keyboard focus in the app's focus ring, as the controls beside it are, for
  // an icon that isn't an info or FX icon and so has no hover look to show in its place
  focusRing?: boolean
}

type IconTooltipSideBoundary = 'bounds' | 'viewport'

const levelConfig: Record<IconTooltipLevel, { Icon: LucideIcon; color: string }> = {
  info: {
    Icon: Info,
    color: 'var(--app-text-subtle)',
  },
  warn: {
    Icon: TriangleAlert,
    color: 'var(--app-warning-text)',
  },
  important: {
    Icon: TriangleAlert,
    color: 'var(--app-negative)',
  },
}

const ICON_TRIGGER_CLASS = 'inline-flex cursor-pointer appearance-none border-0 bg-transparent p-0'
// Keyboard focus shows what hovering shows, the filled icon and the open tooltip, so the trigger draws
// no ring of its own unless it asks for the ring below, which takes this one's place
const ICON_NO_RING_CLASS = 'focus-visible:outline-none'
const ICON_HIT_AREA_CLASS = "relative before:absolute before:-inset-1.5 before:content-['']"
const ICON_FOCUS_RING_CLASS =
  'rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-focus-ring)]'
const ICON_CLASS = 'transition-colors [&>*:first-child]:transition-colors [&>*:not(:first-child)]:transition-colors'
const ICON_HOVER_CLASS =
  'group-hover:[&>*:first-child]:fill-current group-hover:[&>*:not(:first-child)]:stroke-[var(--app-bg)]'
const ICON_ACTIVE_CLASS = '[&>*:first-child]:fill-current [&>*:not(:first-child)]:stroke-[var(--app-bg)]'
const ROOT_CLASS = 'group relative inline-flex'
const FX_ROOT_CLASS = 'shrink-0 items-center align-middle leading-none'
const FX_TRIGGER_CLASS =
  'inline-flex h-4 cursor-pointer appearance-none items-center justify-center rounded-[4px] border px-[3px] text-[0.625rem] font-bold leading-none transition-colors focus-visible:outline-none'
// Above the list toolbars, which stick at z-30 over the page as it scrolls, so a panel that opens
// across a toolbar is drawn over it rather than under it. Fixed rather than absolute, so a scrolling
// box around the trigger, such as a dialog's body, never cuts the panel off
const TOOLTIP_WRAPPER_CLASS = 'fixed z-40 p-2 transition-opacity duration-150'

// Closed, the panel shows and takes pointer input only while hovered. Open, it does both whatever the
// pointer, since a touch screen has no hover. The two are kept apart because classes setting the same
// property are ordered by the stylesheet, not by the class list
const TOOLTIP_CLOSED_CLASS = 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100'
const TOOLTIP_OPEN_CLASS = 'pointer-events-auto opacity-100'

type TooltipPosition = { left: number; top: number }

// The side of the trigger the panel opens on, and how far it moves up or down from the trigger's edge on
// that side to clear what the trigger explains
type TooltipSide = ReturnType<typeof getIconTooltipPlacement>

/**
 * Picks the side of the trigger the panel opens on, the preferred one unless only the other has room, or
 * beyond the whole of what the trigger explains when it sits inside an element marked `data-tooltip-subject`
 */
function getTooltipSide(
  trigger: HTMLElement,
  tooltip: HTMLElement,
  preferredPlacement: IconTooltipPlacement,
  sideBoundary: IconTooltipSideBoundary,
): TooltipSide {
  const triggerRect = trigger.getBoundingClientRect()
  return getIconTooltipPlacement({
    preferred: preferredPlacement,
    icon: triggerRect,
    tooltipHeight: tooltip.getBoundingClientRect().height,
    subject: trigger.closest('[data-tooltip-subject]')?.getBoundingClientRect(),
    surface: sideBoundary === 'bounds' ? trigger.closest('[data-tooltip-bounds]')?.getBoundingClientRect() : undefined,
    coverBottom: getTooltipCoverBottom(trigger, triggerRect),
    screenHeight: window.innerHeight,
  })
}

/**
 * Works out where the fixed panel goes on the given side of the trigger, shifted sideways to stay in bounds
 *
 * A fixed element measures from the viewport unless an ancestor's transform or filter makes itself the box
 * it measures from, as a frosted toolbar's backdrop filter does. The panel's current place on screen,
 * against the coordinates it was given, shows where that box starts, so the result is written in its terms
 */
function getTooltipPosition(trigger: HTMLElement, tooltip: HTMLElement, side: TooltipSide): TooltipPosition {
  const triggerRect = trigger.getBoundingClientRect()
  const tooltipRect = tooltip.getBoundingClientRect()
  const left =
    triggerRect.left +
    triggerRect.width / 2 -
    tooltipRect.width / 2 +
    getIconTooltipOffset({
      icon: triggerRect,
      tooltipWidth: tooltipRect.width,
      surface: trigger.closest('[data-tooltip-bounds]')?.getBoundingClientRect(),
      page: document.getElementById('app-page-content')?.getBoundingClientRect(),
      screenWidth: window.innerWidth,
    })
  const top =
    side.placement === 'top' ? triggerRect.top + side.shift - tooltipRect.height : triggerRect.bottom + side.shift
  const originLeft = tooltipRect.left - (parseFloat(tooltip.style.left) || 0)
  const originTop = tooltipRect.top - (parseFloat(tooltip.style.top) || 0)
  return { left: left - originLeft, top: top - originTop }
}

/**
 * Icon that opens a tooltip panel on click, showing `children` as its content
 *
 * The panel opens above or below the trigger, whichever has room within the viewport or the nearest
 * ancestor marked with `data-tooltip-bounds` and clear of any bar above it marked with
 * `data-tooltip-cover`, and shifts sideways to stay within them. While it shows it keeps that side until
 * a press on the trigger opens it, which picks the side afresh, and it is placed again with the trigger
 * on any scroll or resize, and whenever the trigger moves on its own, as it does during a dialog's
 * entrance. It hides while its trigger is scrolled out of view, and it closes on any pointer down
 * outside the trigger. A trigger inside an element marked with
 * `data-tooltip-subject`, such as a fact whose value sits under its label, opens the panel above or
 * below that whole element, so the panel never covers what it explains, and picks its side again as
 * anything around it scrolls while it shows
 *
 * The panel is as wide as its content up to 13rem, so a short note sits in a small panel rather than
 * one with a ragged gap beside it. A caller passing its own width takes that width instead. A note
 * that wraps avoids leaving one word alone on its last line, where the browser supports it, rather
 * than balancing its lines, which would leave the panel wider than the text it fits
 */
export default function IconTooltip({
  label,
  children,
  level = 'info',
  placement = 'top',
  widthClassName = 'w-max max-w-52',
  icon: IconOverride,
  iconColor,
  fxTone = 'blue',
  size = 15,
  strokeWidth = 2.5,
  modalFieldTabStop = false,
  interactive = false,
  sideBoundary = 'bounds',
  hoverFill = true,
  widensHitArea = false,
  focusRing = false,
}: IconTooltipProps) {
  const { Icon: DefaultIcon, color } = levelConfig[level]
  const isFxIcon = IconOverride === 'fx'
  const Icon = isFxIcon ? DefaultIcon : (IconOverride ?? DefaultIcon)
  const [isOpen, setIsOpen] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [isKeyboardFocused, setIsKeyboardFocused] = useState(false)
  const isShown = isOpen || isKeyboardFocused
  const [position, setPosition] = useState<TooltipPosition>({ left: 0, top: 0 })
  const rootRef = useRef<HTMLSpanElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const tooltipRef = useRef<HTMLSpanElement>(null)

  // The side is picked once as the panel shows and kept until it hides, so a panel that opened above its
  // trigger never swaps over what the trigger labels as the page moves. A press that opens the panel
  // picks it afresh, since a pointer left on the trigger keeps a closed panel in place, shown where the
  // screen has hover, and keyboard focus on it keeps the panel showing, each with the side it had. A
  // panel beside what it explains covers it on neither side, so it picks again each time, and one that
  // showed above a fact goes below it once scrolling leaves no room above
  const sideRef = useRef<TooltipSide | null>(null)
  const isPlaced = isShown || isHovered
  const updatePlacement = useCallback(() => {
    const trigger = triggerRef.current
    const tooltip = tooltipRef.current
    if (!trigger || !tooltip) return
    if (!sideRef.current || trigger.closest('[data-tooltip-subject]')) {
      sideRef.current = getTooltipSide(trigger, tooltip, placement, sideBoundary)
    }
    setPosition(getTooltipPosition(trigger, tooltip, sideRef.current))
  }, [placement, sideBoundary])

  // A fixed panel stays where it was put while the page under it moves, so it follows the trigger for as
  // long as it shows. Scrolls are caught on the way down, since a dialog's body scrolls without the page.
  // Once it hides, the side is picked afresh the next time it shows
  useEffect(() => {
    if (!isPlaced) return undefined

    window.addEventListener('scroll', updatePlacement, { capture: true, passive: true })
    window.addEventListener('resize', updatePlacement)
    return () => {
      window.removeEventListener('scroll', updatePlacement, { capture: true })
      window.removeEventListener('resize', updatePlacement)
      sideRef.current = null
    }
  }, [isPlaced, updatePlacement])

  // A trigger can also move with nothing scrolling or resizing, as a dialog's entrance scales and slides
  // it into place, and a panel put where the trigger was mid-move rests off it once it stops. So the
  // panel is put again whenever a frame finds the trigger somewhere new
  useEffect(() => {
    if (!isPlaced) return undefined

    let frame = 0
    let lastSeen = ''
    const watch = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      const seen = rect ? `${rect.left},${rect.top}` : ''
      if (seen !== lastSeen) {
        lastSeen = seen
        updatePlacement()
      }
      frame = requestAnimationFrame(watch)
    }
    frame = requestAnimationFrame(watch)
    return () => cancelAnimationFrame(frame)
  }, [isPlaced, updatePlacement])

  // Floating free of the box that scrolls the trigger, the panel would stay on screen over whatever else
  // that box shows once the trigger scrolls out of it, so it hides until the trigger is back in view
  const [isTriggerOutOfView, setIsTriggerOutOfView] = useState(false)
  useEffect(() => {
    const trigger = triggerRef.current
    if (!isPlaced || !trigger) return undefined

    const observer = new IntersectionObserver((entries) =>
      setIsTriggerOutOfView(!entries[entries.length - 1].isIntersecting),
    )
    observer.observe(trigger)
    // Hidden, the panel forgets where the trigger was, so it never shows again hidden for a frame
    return () => {
      observer.disconnect()
      setIsTriggerOutOfView(false)
    }
  }, [isPlaced])

  useEffect(() => {
    if (!isOpen) return undefined

    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return
      setIsOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [isOpen])

  const fxToneClass = FX_TONE_CLASS[fxTone]
  const triggerClassName = joinClassNames(
    isFxIcon ? FX_TRIGGER_CLASS : ICON_TRIGGER_CLASS,
    isFxIcon && (isShown ? fxToneClass.active : fxToneClass.idle),
    !isFxIcon && widensHitArea && ICON_HIT_AREA_CLASS,
    !isFxIcon && (focusRing ? ICON_FOCUS_RING_CLASS : ICON_NO_RING_CLASS),
  )
  const iconClassName = joinClassNames(
    ICON_CLASS,
    hoverFill && ICON_HOVER_CLASS,
    hoverFill && isShown && ICON_ACTIVE_CLASS,
  )
  const tooltipWrapperClassName = joinClassNames(
    TOOLTIP_WRAPPER_CLASS,
    isShown ? TOOLTIP_OPEN_CLASS : TOOLTIP_CLOSED_CLASS,
  )
  const rootClassName = joinClassNames(ROOT_CLASS, isFxIcon && FX_ROOT_CLASS)

  return (
    <span
      ref={rootRef}
      className={rootClassName}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={(event) => setIsKeyboardFocused(event.target.matches(':focus-visible'))}
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget as Node | null)) setIsKeyboardFocused(false)
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-expanded={isOpen}
        data-modal-field-tab-stop={modalFieldTabStop ? 'true' : undefined}
        data-fx-tone={isFxIcon ? fxTone : undefined}
        className={triggerClassName}
        style={isFxIcon ? undefined : { color: iconColor ?? color }}
        onClick={() => {
          if (!isOpen) sideRef.current = null
          updatePlacement()
          setIsOpen((open) => !open)
        }}
        onFocus={updatePlacement}
        onMouseEnter={updatePlacement}
      >
        {isFxIcon ? 'FX' : <Icon size={size} strokeWidth={strokeWidth} aria-hidden className={iconClassName} />}
      </button>
      {/* Hidden from assistive technology until it shows, opened or reached from the keyboard, so a
          screen reader does not read a panel nobody can see after the trigger has already named it */}
      <span
        ref={tooltipRef}
        role={interactive ? undefined : 'tooltip'}
        className={tooltipWrapperClassName}
        aria-hidden={!isShown && !isHovered ? true : undefined}
        inert={interactive && !isShown && !isHovered}
        style={{
          left: position.left,
          top: position.top,
          visibility: (interactive && !isShown && !isHovered) || isTriggerOutOfView ? 'hidden' : undefined,
        }}
      >
        <span
          className={`app-tooltip-panel block rounded-md px-2.5 py-1.5 text-left text-sm font-medium text-pretty shadow-sm ${widthClassName}`}
          style={{ border: '1px solid var(--app-border-strong)' }}
        >
          {children}
        </span>
      </span>
    </span>
  )
}
