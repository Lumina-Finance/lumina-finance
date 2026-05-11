import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Info, TriangleAlert, type LucideIcon } from 'lucide-react'

export type IconTooltipLevel = 'info' | 'warn' | 'important'

type IconTooltipPlacement = 'top' | 'bottom'

interface IconTooltipProps {
  label: string
  children: ReactNode
  level?: IconTooltipLevel
  placement?: IconTooltipPlacement
  widthClassName?: string
  iconColor?: string
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

export default function IconTooltip({
  label,
  children,
  level = 'info',
  placement = 'top',
  widthClassName = 'w-52',
  iconColor,
  size = 15,
  strokeWidth = 2.5,
}: IconTooltipProps) {
  const { Icon, color } = levelConfig[level]
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!isOpen) return undefined

    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return
      setIsOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [isOpen])

  return (
    <span ref={rootRef} className="group relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-expanded={isOpen}
        className="inline-flex cursor-pointer appearance-none border-0 bg-transparent p-0"
        style={{ color: iconColor ?? color }}
        onClick={() => setIsOpen((open) => !open)}
      >
        <Icon
          size={size}
          strokeWidth={strokeWidth}
          aria-hidden
          className={`transition-colors [&>*:first-child]:transition-colors [&>*:not(:first-child)]:transition-colors group-hover:[&>*:first-child]:fill-current group-hover:[&>*:not(:first-child)]:stroke-[var(--app-bg)] ${isOpen ? '[&>*:first-child]:fill-current [&>*:not(:first-child)]:stroke-[var(--app-bg)]' : ''}`}
        />
      </button>
      <span
        className={`pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 p-2 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 ${isOpen ? 'pointer-events-auto opacity-100' : ''} ${placementClass[placement]}`}
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
