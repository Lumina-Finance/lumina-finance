import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Info, TriangleAlert, type LucideIcon } from 'lucide-react'
import { joinClassNames } from '@/utils/classNames'
import { FX_TONE_CLASS, type IconTooltipFxTone } from '@/components/tooltips/fxToneClass'

export type IconTooltipLevel = 'info' | 'warn' | 'important'

type IconTooltipPlacement = 'top' | 'bottom'
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

// Keyboard focus shows what hovering shows, the filled icon and the open tooltip, so the trigger draws
// no ring of its own
const ICON_TRIGGER_CLASS = 'inline-flex cursor-pointer appearance-none border-0 bg-transparent p-0 focus-visible:outline-none'
const ICON_CLASS = 'transition-colors [&>*:first-child]:transition-colors [&>*:not(:first-child)]:transition-colors'
const ICON_HOVER_CLASS = 'group-hover:[&>*:first-child]:fill-current group-hover:[&>*:not(:first-child)]:stroke-[var(--app-bg)]'
const ICON_ACTIVE_CLASS = '[&>*:first-child]:fill-current [&>*:not(:first-child)]:stroke-[var(--app-bg)]'
const ROOT_CLASS = 'group relative inline-flex'
const FX_ROOT_CLASS = 'shrink-0 items-center align-middle leading-none'
const FX_TRIGGER_CLASS = 'inline-flex h-4 cursor-pointer appearance-none items-center justify-center rounded-[4px] border px-[3px] text-[0.625rem] font-bold leading-none transition-colors focus-visible:outline-none'
// Above the list toolbars, which stick at z-30 over the page as it scrolls, so a panel that opens
// across a toolbar is drawn over it rather than under it. Fixed rather than absolute, so a scrolling
// box around the trigger, such as a dialog's body, never cuts the panel off
const TOOLTIP_WRAPPER_CLASS = 'fixed z-40 p-2 transition-opacity duration-150'
// Closed, the panel shows and takes pointer input only while hovered. Open, it does both whatever the
// pointer, since a touch screen has no hover. The two are kept apart because classes setting the same
// property are ordered by the stylesheet, not by the class list
const TOOLTIP_CLOSED_CLASS = 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100'
const TOOLTIP_OPEN_CLASS = 'pointer-events-auto opacity-100'

function getAvailablePlacement({
  preferredPlacement,
  triggerRect,
  tooltipRect,
  boundaryRect,
}: {
  preferredPlacement: IconTooltipPlacement
  triggerRect: DOMRect
  tooltipRect: DOMRect
  boundaryRect?: DOMRect
}): IconTooltipPlacement {
  const viewportPadding = 8
  const boundaryTop = Math.max(viewportPadding, boundaryRect ? boundaryRect.top + viewportPadding : viewportPadding)
  const boundaryBottom = Math.min(
    window.innerHeight - viewportPadding,
    boundaryRect ? boundaryRect.bottom - viewportPadding : window.innerHeight - viewportPadding,
  )
  const topWouldClip = triggerRect.top - tooltipRect.height < boundaryTop
  const bottomWouldClip = triggerRect.bottom + tooltipRect.height > boundaryBottom

  if (preferredPlacement === 'top') {
    return topWouldClip && !bottomWouldClip ? 'bottom' : 'top'
  }

  return bottomWouldClip && !topWouldClip ? 'top' : 'bottom'
}

function getHorizontalOffset({
  triggerRect,
  tooltipRect,
  boundaryRect,
}: {
  triggerRect: DOMRect
  tooltipRect: DOMRect
  boundaryRect?: DOMRect
}): number {
  const viewportPadding = 8
  const pageContentRect = document.getElementById('app-page-content')?.getBoundingClientRect()
  const boundaryLeft = Math.max(
    viewportPadding,
    pageContentRect ? pageContentRect.left + viewportPadding : viewportPadding,
    boundaryRect ? boundaryRect.left + viewportPadding : viewportPadding,
  )
  const boundaryRight = Math.min(
    window.innerWidth - viewportPadding,
    pageContentRect ? pageContentRect.right - viewportPadding : window.innerWidth - viewportPadding,
    boundaryRect ? boundaryRect.right - viewportPadding : window.innerWidth - viewportPadding,
  )
  const triggerCenter = triggerRect.left + triggerRect.width / 2
  const tooltipLeft = triggerCenter - tooltipRect.width / 2
  const tooltipRight = triggerCenter + tooltipRect.width / 2

  if (tooltipLeft < boundaryLeft) return boundaryLeft - tooltipLeft
  if (tooltipRight > boundaryRight) return boundaryRight - tooltipRight
  return 0
}

type TooltipPosition = { left: number; top: number }

/** Picks the side of the trigger the panel opens on, the preferred one unless only the other has room */
function getTooltipSide(
  trigger: HTMLElement,
  tooltip: HTMLElement,
  preferredPlacement: IconTooltipPlacement,
  sideBoundary: IconTooltipSideBoundary,
): IconTooltipPlacement {
  const boundaryRect = sideBoundary === 'bounds' ? trigger.closest('[data-tooltip-bounds]')?.getBoundingClientRect() : undefined
  return getAvailablePlacement({
    preferredPlacement,
    triggerRect: trigger.getBoundingClientRect(),
    tooltipRect: tooltip.getBoundingClientRect(),
    boundaryRect,
  })
}

/**
 * Works out where the fixed panel goes on the given side of the trigger, shifted sideways to stay in bounds
 *
 * A fixed element measures from the viewport unless an ancestor's transform or filter makes itself the box
 * it measures from, as a frosted toolbar's backdrop filter does. The panel's current place on screen,
 * against the coordinates it was given, shows where that box starts, so the result is written in its terms
 */
function getTooltipPosition(trigger: HTMLElement, tooltip: HTMLElement, placement: IconTooltipPlacement): TooltipPosition {
  const triggerRect = trigger.getBoundingClientRect()
  const tooltipRect = tooltip.getBoundingClientRect()
  const boundaryRect = trigger.closest('[data-tooltip-bounds]')?.getBoundingClientRect()
  const left = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2
    + getHorizontalOffset({ triggerRect, tooltipRect, boundaryRect })
  const top = placement === 'top' ? triggerRect.top - tooltipRect.height : triggerRect.bottom
  const originLeft = tooltipRect.left - (parseFloat(tooltip.style.left) || 0)
  const originTop = tooltipRect.top - (parseFloat(tooltip.style.top) || 0)
  return { left: left - originLeft, top: top - originTop }
}

/**
 * Icon that opens a tooltip panel on click, showing `children` as its content
 *
 * The panel opens above or below the trigger, whichever has room within the viewport or the nearest
 * ancestor marked with `data-tooltip-bounds`, and shifts sideways to stay within them. While it shows it
 * keeps that side, and any scroll or resize only moves it with the trigger. It hides while its trigger is
 * scrolled out of view, and it closes on any pointer down outside the trigger
 */
export default function IconTooltip({
  label,
  children,
  level = 'info',
  placement = 'top',
  widthClassName = 'w-52',
  icon: IconOverride,
  iconColor,
  fxTone = 'blue',
  size = 15,
  strokeWidth = 2.5,
  modalFieldTabStop = false,
  interactive = false,
  sideBoundary = 'bounds',
}: IconTooltipProps) {
  const { Icon: DefaultIcon, color } = levelConfig[level]
  const isFxIcon = IconOverride === 'fx'
  const Icon = isFxIcon ? DefaultIcon : IconOverride ?? DefaultIcon
  const [isOpen, setIsOpen] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [isKeyboardFocused, setIsKeyboardFocused] = useState(false)
  const isShown = isOpen || isKeyboardFocused
  const [position, setPosition] = useState<TooltipPosition>({ left: 0, top: 0 })
  const rootRef = useRef<HTMLSpanElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const tooltipRef = useRef<HTMLSpanElement>(null)

  // The side is picked once as the panel shows and kept until it hides, so a panel that opened above its
  // trigger never swaps over what the trigger labels as the page moves
  const sideRef = useRef<IconTooltipPlacement | null>(null)
  const isPlaced = isShown || isHovered
  const updatePlacement = useCallback(() => {
    if (!triggerRef.current || !tooltipRef.current) return
    sideRef.current ??= getTooltipSide(triggerRef.current, tooltipRef.current, placement, sideBoundary)
    setPosition(getTooltipPosition(triggerRef.current, tooltipRef.current, sideRef.current))
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

  // Floating free of the box that scrolls the trigger, the panel would stay on screen over whatever else
  // that box shows once the trigger scrolls out of it, so it hides until the trigger is back in view
  const [isTriggerOutOfView, setIsTriggerOutOfView] = useState(false)
  useEffect(() => {
    const trigger = triggerRef.current
    if (!isPlaced || !trigger) return undefined

    const observer = new IntersectionObserver((entries) => setIsTriggerOutOfView(!entries[entries.length - 1].isIntersecting))
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
  const triggerClassName = isFxIcon
    ? joinClassNames(FX_TRIGGER_CLASS, isShown ? fxToneClass.active : fxToneClass.idle)
    : ICON_TRIGGER_CLASS
  const iconClassName = joinClassNames(ICON_CLASS, ICON_HOVER_CLASS, isShown && ICON_ACTIVE_CLASS)
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
        className={triggerClassName}
        style={isFxIcon ? undefined : { color: iconColor ?? color }}
        onClick={() => {
          updatePlacement()
          setIsOpen((open) => !open)
        }}
        onFocus={updatePlacement}
        onMouseEnter={updatePlacement}
      >
        {isFxIcon ? (
          'FX'
        ) : (
          <Icon
            size={size}
            strokeWidth={strokeWidth}
            aria-hidden
            className={iconClassName}
          />
        )}
      </button>
      <span
        ref={tooltipRef}
        role={interactive ? undefined : 'tooltip'}
        className={tooltipWrapperClassName}
        inert={interactive && !isShown && !isHovered}
        style={{
          left: position.left,
          top: position.top,
          visibility: (interactive && !isShown && !isHovered) || isTriggerOutOfView ? 'hidden' : undefined,
        }}
      >
        <span
          className={`app-tooltip-panel block rounded-md px-2.5 py-1.5 text-left text-sm font-medium shadow-sm ${widthClassName}`}
          style={{ border: '1px solid var(--app-border-strong)' }}
        >
          {children}
        </span>
      </span>
    </span>
  )
}
