type CalendarDayProps = {
  date: Date
  // The day as an ISO yyyy-mm-dd string
  iso: string
  inMonth: boolean
  isSelected: boolean
  isToday: boolean

  // A day the field refuses, drawn struck through and ignored when clicked or pressed. It stays
  // focusable so arrow keys can still walk across it to a permitted day
  isDisabled: boolean

  // Whether this is the one day in the grid that Tab lands on
  focusable: boolean
  onPick: (iso: string) => void
}

/**
 * One day in the calendar's month grid
 *
 * Enter and Space reach a button as a click, so the one guard on the click refuses a disabled day
 * from the keyboard as well as the pointer
 */
export function CalendarDay({
  date,
  iso,
  inMonth,
  isSelected,
  isToday,
  isDisabled,
  focusable,
  onPick,
}: CalendarDayProps) {
  return (
    <button
      type="button"
      data-iso={iso}
      tabIndex={focusable ? 0 : -1}
      aria-pressed={isSelected}
      aria-disabled={isDisabled || undefined}
      onClick={() => {
        if (isDisabled) return
        onPick(iso)
      }}
      className="app-calendar-day"
      data-selected={isSelected || undefined}
      data-today={isToday || undefined}
      data-outside={!inMonth || undefined}
      data-disabled={isDisabled || undefined}
    >
      {date.getDate()}
    </button>
  )
}
