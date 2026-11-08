/**
 * Guards a day the date field refuses: it must be marked unavailable to the eye and to assistive
 * technology, and a click, or Enter or Space which reach the button as a click, must not pick it. A
 * field that gives a reason names it for a screen reader, and one that gives none renders as before
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

  it('gives a refused day its reason to a screen reader and keeps its press from picking it', () => {
    const onPick = vi.fn()
    const reason = 'SimpleFIN supplies this account’s transactions from Jun 1, 2026 to today'
    const markup = renderToStaticMarkup(<CalendarDay {...DAY} isDisabled disabledReason={reason} onPick={onPick} />)
    const describedBy = /aria-describedby="([^"]+)"/.exec(markup)?.[1]

    expect(markup).toContain('aria-disabled="true"')
    expect(describedBy).toBeDefined()
    expect(markup).toContain(`<span id="${describedBy}" hidden="">${reason}</span>`)
    expect(markup).not.toContain(' disabled=')

    CalendarDay({ ...DAY, isDisabled: true, disabledReason: reason, onPick }).props.onClick()
    expect(onPick).not.toHaveBeenCalled()
  })

  it('renders a refused day with no reason as a struck button that says nothing, as before reasons', () => {
    const markup = renderToStaticMarkup(<CalendarDay {...DAY} isDisabled onPick={() => {}} />)

    expect(markup).toContain('aria-disabled="true"')
    expect(markup).not.toContain('aria-describedby')
    expect(markup).not.toContain('hidden=')
    expect(markup).not.toContain('disabled-reason-tooltip')
  })

  it('ignores a reason given for a permitted day', () => {
    const markup = renderToStaticMarkup(
      <CalendarDay {...DAY} isDisabled={false} disabledReason="Not shown" onPick={() => {}} />,
    )

    expect(markup).not.toContain('aria-describedby')
    expect(markup).not.toContain('Not shown')
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
