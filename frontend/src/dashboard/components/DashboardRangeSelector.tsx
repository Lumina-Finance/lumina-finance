import {
  TimeRangeSelector,
  type TimeRangeSelectorOption,
} from '@/components/TimeRangeSelector'

type DashboardRangeSelectorProps<T extends string> = {
  value: T
  options: readonly TimeRangeSelectorOption<T>[]
  onChange: (value: T) => void
  ariaLabel: string
  sheetTitle: string
  desktopClassName?: string
}

/**
 * Renders the dashboard desktop segmented range selector with its mobile sheet fallback
 */
export function DashboardRangeSelector<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  sheetTitle,
  desktopClassName = 'ml-auto hidden min-[730px]:inline-flex',
}: DashboardRangeSelectorProps<T>) {
  return (
    <>
      <TimeRangeSelector
        value={value}
        options={options}
        onChange={onChange}
        ariaLabel={ariaLabel}
        className={desktopClassName}
      />
      <TimeRangeSelector
        value={value}
        options={options}
        onChange={onChange}
        ariaLabel={ariaLabel}
        variant="mobile"
        className="w-full min-[730px]:hidden"
        sheetTitle={sheetTitle}
      />
    </>
  )
}
