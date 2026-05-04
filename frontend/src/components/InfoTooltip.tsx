import type { ReactNode } from 'react'
import { Info } from 'lucide-react'

type InfoTooltipPlacement = 'top' | 'bottom'

interface InfoTooltipProps {
  label: string
  children: ReactNode
  placement?: InfoTooltipPlacement
  widthClassName?: string
  iconColor?: string
  size?: number
  strokeWidth?: number
}

const placementClass: Record<InfoTooltipPlacement, string> = {
  top: 'bottom-full',
  bottom: 'top-full',
}

export default function InfoTooltip({
  label,
  children,
  placement = 'top',
  widthClassName = 'w-52',
  iconColor = 'var(--app-text-subtle)',
  size = 15,
  strokeWidth = 2.5,
}: InfoTooltipProps) {
  return (
    <span className="group relative inline-flex">
      <Info
        size={size}
        strokeWidth={strokeWidth}
        aria-label={label}
        className="cursor-pointer transition-colors [&_circle]:transition-colors [&_path]:transition-colors group-hover:[&_circle]:fill-current group-hover:[&_path]:stroke-[var(--app-bg)]"
        style={{ color: iconColor }}
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
