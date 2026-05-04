import type { ReactNode } from 'react'
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

  return (
    <span className="group relative inline-flex">
      <Icon
        size={size}
        strokeWidth={strokeWidth}
        aria-label={label}
        className="cursor-pointer transition-colors [&>*:first-child]:transition-colors [&>*:not(:first-child)]:transition-colors group-hover:[&>*:first-child]:fill-current group-hover:[&>*:not(:first-child)]:stroke-[var(--app-bg)]"
        style={{ color: iconColor ?? color }}
      />
      <span
        className={`pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 p-2 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 ${placementClass[placement]}`}
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
