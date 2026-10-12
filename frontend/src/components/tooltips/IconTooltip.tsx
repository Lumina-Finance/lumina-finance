import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Info, TriangleAlert, type LucideIcon } from 'lucide-react'
import { joinClassNames } from '@/utils/classNames'

export type IconTooltipLevel = 'info' | 'warn' | 'important'

type IconTooltipPlacement = 'top' | 'bottom'
type IconTooltipIcon = LucideIcon | 'fx'
type IconTooltipFxTone = 'blue' | 'red' | 'gray'

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
}

const placementClass: Record<IconTooltipPlacement, string> = {
  top: 'bottom-full',
  bottom: 'top-full',
}

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
const FX_TONE_CLASS: Record<IconTooltipFxTone, { idle: string; active: string }> = {
  blue: {
    idle: 'border-[color-mix(in_srgb,#2563eb_48%,transparent)] bg-[color-mix(in_srgb,#2563eb_13%,var(--app-bg))] text-[#2563eb] group-hover:border-[#2563eb] group-hover:bg-[#2563eb] group-hover:text-white',
    active: 'border-[#2563eb] bg-[#2563eb] text-white',
  },
  red: {
    idle: 'border-[color-mix(in_srgb,var(--app-negative)_48%,transparent)] bg-[color-mix(in_srgb,var(--app-negative)_13%,var(--app-bg))] text-[var(--app-negative)] group-hover:border-[var(--app-negative)] group-hover:bg-[var(--app-negative)] group-hover:text-white',
    active: 'border-[var(--app-negative)] bg-[var(--app-negative)] text-white',
  },
  gray: {
    idle: 'border-[var(--app-border)] bg-transparent text-[var(--app-text-subtle)] opacity-70 group-hover:border-[var(--app-text-muted)] group-hover:bg-[var(--app-text-muted)] group-hover:text-white group-hover:opacity-100',
    active: 'border-[var(--app-text-muted)] bg-[var(--app-text-muted)] text-white opacity-100',
  },
}
// Above the list toolbars, which stick at z-30 over the page as it scrolls, so a panel that opens
// across a toolbar is drawn over it rather than under it
const TOOLTIP_WRAPPER_CLASS = 'absolute left-1/2 z-40 p-2 transition-opacity duration-150'
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

/**
 * Icon that opens a tooltip panel on click, showing `children` as its content
 *
 * The panel's placement and horizontal offset are recalculated on open, hover, and focus so it flips
 * above or below the trigger and shifts sideways to stay within the viewport or the nearest ancestor
 * marked with `data-tooltip-bounds`, and it closes on any pointer down outside the trigger
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
}: IconTooltipProps) {
  const { Icon: DefaultIcon, color } = levelConfig[level]
  const isFxIcon = IconOverride === 'fx'
  const Icon = isFxIcon ? DefaultIcon : IconOverride ?? DefaultIcon
  const [isOpen, setIsOpen] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [isKeyboardFocused, setIsKeyboardFocused] = useState(false)
  const isShown = isOpen || isKeyboardFocused
  const [actualPlacement, setActualPlacement] = useState<IconTooltipPlacement>(placement)
  const [horizontalOffset, setHorizontalOffset] = useState(0)
  const rootRef = useRef<HTMLSpanElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const tooltipRef = useRef<HTMLSpanElement>(null)

  const updatePlacement = useCallback(() => {
    const triggerRect = triggerRef.current?.getBoundingClientRect()
    const tooltipRect = tooltipRef.current?.getBoundingClientRect()
    if (!triggerRect || !tooltipRect) return

    const boundaryRect = triggerRef.current
      ?.closest('[data-tooltip-bounds]')
      ?.getBoundingClientRect()

    setActualPlacement(getAvailablePlacement({
      preferredPlacement: placement,
      triggerRect,
      tooltipRect,
      boundaryRect,
    }))
    setHorizontalOffset(getHorizontalOffset({ triggerRect, tooltipRect, boundaryRect }))
  }, [placement])

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
    placementClass[actualPlacement],
  )
  const rootClassName = joinClassNames(ROOT_CLASS, isFxIcon && FX_ROOT_CLASS)

  return (
    <span
      ref={rootRef}
      className={rootClassName}
      onMouseEnter={interactive ? () => setIsHovered(true) : undefined}
      onMouseLeave={interactive ? () => setIsHovered(false) : undefined}
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
          transform: `translateX(calc(-50% + ${horizontalOffset}px))`,
          visibility: interactive && !isShown && !isHovered ? 'hidden' : undefined,
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
