/**
 * Covers how the link flow's start step shows a refusal: the custom date's message and the choice's
 * message appear only when handed in, never from what the date holds, and each points its control to
 * the message
 *
 * These tests catch the out of range message drawn while the date is merely typed, a bare span in
 * place of the shared field message, and a date or choice left unmarked once a press found it wrong
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { BankImportRange } from '@/api/bank-sync'
import { StartStep } from '@/components/bank-link-flow/StartStep'
import { CUSTOM_START, type StartChoiceState } from '@/components/bank-link-flow/useStartChoice'

vi.mock('@/components/date-field/DateField', () => ({
  default: ({ id, error, describedById }: { id?: string; error?: boolean; describedById?: string }) => (
    <input id={id} aria-invalid={error} aria-describedby={error ? describedById : undefined} />
  ),
}))

const RANGE: BankImportRange = {
  suggested_start: '2026-07-01',
  default_suggestion: '2026-07-01',
  earliest_allowed: '2025-10-01',
  latest_allowed: '2026-10-05',
  ledger_floor: null,
  provider_limit_date: '2025-10-01',
  provider_history_months: 12,
  latest_ledger_date: null,
}

function renderStep(errors: { startChoice?: string; startDate?: string }, choice: string | null = CUSTOM_START) {
  const startChoice = {
    choice,
    choose: () => {},
    customStart: '2020-01-01',
    setCustomStart: () => {},
    choices: [{ key: '3', label: '3 months', date: '2026-07-01' }],
    start: '2020-01-01',
    outOfRange: true,
    isDateDisabled: () => true,
    uncoveredUntil: null,
    reset: () => {},
  } as StartChoiceState
  return renderToStaticMarkup(
    <StartStep
      range={RANGE}
      bankAccountName="Everyday Chequing"
      providerName="SimpleFIN"
      advertisesHistory
      startChoice={startChoice}
      errors={errors}
      onDateBlur={() => {}}
      disabled={false}
    />,
  )
}

describe('the start step', () => {
  it('stays unmarked while the custom date is out of range until a press or leaving the date finds it', () => {
    const markup = renderStep({})

    expect(markup).not.toContain('Outside the allowed range.')
    expect(markup).not.toContain('role="alert"')
    expect(markup).not.toContain('aria-invalid="true"')
  })

  it('shows the custom date message as a field message the date points to', () => {
    const markup = renderStep({ startDate: 'Outside the allowed range.' })

    expect(markup).toMatch(/<p id="bank-link-start-date-error" role="alert"[^>]*>Outside the allowed range\.<\/p>/)
    expect(markup).toMatch(
      /<input id="bank-link-start-date" aria-invalid="true" aria-describedby="bank-link-start-date-error"/,
    )
  })

  it('shows the choice message beneath the list, which the list points to, and gives the first choice the focus id', () => {
    const markup = renderStep({ startChoice: 'Choose where to start' }, null)

    expect(markup).toMatch(/<p id="bank-link-start-choice-error" role="alert"[^>]*>Choose where to start<\/p>/)
    expect(markup).toMatch(/role="radiogroup"[^>]*aria-describedby="bank-link-start-choice-error"/)
    expect(markup).toMatch(/<button id="bank-link-start-choice"[^>]*role="radio"/)
  })
})
