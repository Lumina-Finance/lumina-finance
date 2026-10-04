/**
 * Guards a day the date field refuses: it must be marked unavailable to the eye and to assistive
 * technology, and a click, or Enter or Space which reach the button as a click, must not pick it
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CalendarDay } from '@/components/date-field/CalendarDay'

const DAY = {
  date: new Date(2026, 9, 4),
  iso: '2026-10-04',
  inMonth: true,
  isSelected: false,
  isToday: false,
  focusable: true,
}

describe('calendar day', () => {
  it('marks a refused day unavailable and ignores a click on it', () => {
    const onPick = vi.fn()
    const markup = renderToStaticMarkup(<CalendarDay {...DAY} isDisabled onPick={onPick} />)

    expect(markup).toContain('aria-disabled="true"')
    expect(markup).toContain('data-disabled="true"')

    CalendarDay({ ...DAY, isDisabled: true, onPick }).props.onClick()
    expect(onPick).not.toHaveBeenCalled()
  })

  it('picks a permitted day and leaves it unmarked', () => {
    const onPick = vi.fn()
    const markup = renderToStaticMarkup(<CalendarDay {...DAY} isDisabled={false} onPick={onPick} />)

    expect(markup).not.toContain('aria-disabled')
    expect(markup).not.toContain('data-disabled')

    CalendarDay({ ...DAY, isDisabled: false, onPick }).props.onClick()
    expect(onPick).toHaveBeenCalledWith('2026-10-04')
  })
})
