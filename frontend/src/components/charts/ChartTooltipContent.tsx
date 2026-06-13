import type { CSSProperties, ReactNode } from 'react'

type ChartTooltipTitleProps = {
  children: ReactNode
  className?: string
}

type ChartTooltipValueProps = {
  children: ReactNode
  className?: string
  /** Uses the app financial font for amount-like values */
  financial?: boolean
}

type ChartTooltipRowProps = {
  label: ReactNode
  value: ReactNode
  className?: string
  labelClassName?: string
  labelStyle?: CSSProperties
  valueClassName?: string
  valueStyle?: CSSProperties
  /** Uses the app financial font for the row value */
  financialValue?: boolean
}

function getTooltipClassName(baseClassName: string, className: string | undefined) {
  return className ? `${baseClassName} ${className}` : baseClassName
}

/**
 * Renders the shared muted title line inside app chart tooltips
 */
export function ChartTooltipTitle({
  children,
  className,
}: ChartTooltipTitleProps) {
  return (
    <p className={getTooltipClassName('app-chart-tooltip-default-title', className)}>
      {children}
    </p>
  )
}

/**
 * Renders a shared value line inside app chart tooltips
 */
export function ChartTooltipValue({
  children,
  className,
  financial = false,
}: ChartTooltipValueProps) {
  const baseClassName = financial
    ? 'app-chart-tooltip-default-value font-financial'
    : 'app-chart-tooltip-default-value'

  return (
    <div className={getTooltipClassName(baseClassName, className)}>
      {children}
    </div>
  )
}

/**
 * Renders the shared label and value row used by app chart tooltips
 */
export function ChartTooltipRow({
  label,
  value,
  className,
  labelClassName,
  labelStyle,
  valueClassName,
  valueStyle,
  financialValue = false,
}: ChartTooltipRowProps) {
  const valueBaseClassName = financialValue
    ? 'app-chart-tooltip-default-value font-financial'
    : 'app-chart-tooltip-default-value'

  return (
    <div className={getTooltipClassName('mt-1 flex justify-between gap-4', className)}>
      <span
        className={getTooltipClassName('app-chart-tooltip-default-value', labelClassName)}
        style={labelStyle}
      >
        {label}
      </span>
      <span
        className={getTooltipClassName(valueBaseClassName, valueClassName)}
        style={valueStyle}
      >
        {value}
      </span>
    </div>
  )
}
