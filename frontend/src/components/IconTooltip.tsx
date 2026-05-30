import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Info, TriangleAlert, type LucideIcon } from 'lucide-react'

export type IconTooltipLevel = 'info' | 'warn' | 'important'

type IconTooltipPlacement = 'top' | 'bottom'
type IconTooltipIcon = LucideIcon | 'fx'
type IconTooltipFxTone = 'blue' | 'red'

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

const ICON_TRIGGER_CLASS = 'inline-flex cursor-pointer appearance-none border-0 bg-transparent p-0'
const ICON_CLASS = 'transition-colors [&>*:first-child]:transition-colors [&>*:not(:first-child)]:transition-colors'
const ICON_HOVER_CLASS = 'group-hover:[&>*:first-child]:fill-current group-hover:[&>*:not(:first-child)]:stroke-[var(--app-bg)]'
const ICON_ACTIVE_CLASS = '[&>*:first-child]:fill-current [&>*:not(:first-child)]:stroke-[var(--app-bg)]'
const FX_TRIGGER_CLASS = 'inline-flex h-4 cursor-pointer appearance-none items-center justify-center rounded-[4px] border px-[3px] text-[0.625rem] font-bold leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent-soft)]'
const FX_TONE_CLASS: Record<IconTooltipFxTone, { idle: string; active: string }> = {
  blue: {
    idle: 'border-[color-mix(in_srgb,#2563eb_48%,transparent)] bg-[color-mix(in_srgb,#2563eb_13%,var(--app-bg))] text-[#2563eb] group-hover:border-[#2563eb] group-hover:bg-[#2563eb] group-hover:text-white',
    active: 'border-[#2563eb] bg-[#2563eb] text-white',
  },
  red: {
    idle: 'border-[color-mix(in_srgb,var(--app-negative)_48%,transparent)] bg-[color-mix(in_srgb,var(--app-negative)_13%,var(--app-bg))] text-[var(--app-negative)] group-hover:border-[var(--app-negative)] group-hover:bg-[var(--app-negative)] group-hover:text-white',
    active: 'border-[var(--app-negative)] bg-[var(--app-negative)] text-white',
  },
}
const TOOLTIP_WRAPPER_CLASS = 'pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 p-2 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100'
const TOOLTIP_OPEN_CLASS = 'pointer-events-auto opacity-100'

function joinClassNames(...classNames: Array<string | false | undefined>) {
  return classNames.filter(Boolean).join(' ')
}

function getAvailablePlacement({
  preferredPlacement,
  triggerRect,
  tooltipRect,
}: {
  preferredPlacement: IconTooltipPlacement
  triggerRect: DOMRect
  tooltipRect: DOMRect
}): IconTooltipPlacement {
  const viewportPadding = 8
  const topWouldClip = triggerRect.top - tooltipRect.height < viewportPadding
  const bottomWouldClip = triggerRect.bottom + tooltipRect.height > window.innerHeight - viewportPadding

  if (preferredPlacement === 'top') {
    return topWouldClip && !bottomWouldClip ? 'bottom' : 'top'
  }

  return bottomWouldClip && !topWouldClip ? 'top' : 'bottom'
}

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
}: IconTooltipProps) {
  const { Icon: DefaultIcon, color } = levelConfig[level]
  const isFxIcon = IconOverride === 'fx'
  const Icon = isFxIcon ? DefaultIcon : IconOverride ?? DefaultIcon
  const [isOpen, setIsOpen] = useState(false)
  const [actualPlacement, setActualPlacement] = useState<IconTooltipPlacement>(placement)
  const rootRef = useRef<HTMLSpanElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const tooltipRef = useRef<HTMLSpanElement>(null)

  const updatePlacement = useCallback(() => {
    const triggerRect = triggerRef.current?.getBoundingClientRect()
    const tooltipRect = tooltipRef.current?.getBoundingClientRect()
    if (!triggerRect || !tooltipRect) return

    setActualPlacement(getAvailablePlacement({
      preferredPlacement: placement,
      triggerRect,
      tooltipRect,
    }))
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
    ? joinClassNames(FX_TRIGGER_CLASS, isOpen ? fxToneClass.active : fxToneClass.idle)
    : ICON_TRIGGER_CLASS
  const iconClassName = joinClassNames(ICON_CLASS, ICON_HOVER_CLASS, isOpen && ICON_ACTIVE_CLASS)
  const tooltipWrapperClassName = joinClassNames(
    TOOLTIP_WRAPPER_CLASS,
    isOpen && TOOLTIP_OPEN_CLASS,
    placementClass[actualPlacement],
  )

  return (
    <span ref={rootRef} className="group relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-expanded={isOpen}
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
        className={tooltipWrapperClassName}
      >
        <span
          className={`app-tooltip-panel block rounded-md px-2.5 py-1.5 text-sm font-medium shadow-sm ${widthClassName}`}
          style={{ border: '1px solid var(--app-border-strong)' }}
        >
          {children}
        </span>
      </span>
    </span>
  )
}
