/**
 * Covers how the link flow's start step shows its custom dates and a refusal: From and To unfold only
 * once custom dates are chosen, each message appears only when handed in or when the ends cross, and
 * each points its control to the message
 *
 * These tests catch custom dates drawn before they are chosen, a bare span in place of the shared
 * field message, a choice left unmarked once a press found it missing, crossed ends that go unsaid,
 * and a To before today that doesn't say syncing picks up from today
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
  earliest_allowed: '2025-10-01',
  latest_allowed: '2026-10-05',
  ledger_floor: null,
  provider_limit_date: '2025-10-01',
  provider_history_months: 12,
}

type StepErrors = { startChoice?: string; rangeFrom?: string; rangeTo?: string }

function renderStep(
  errors: StepErrors,
  choice: string | null = CUSTOM_START,
  range = { from: '', to: RANGE.latest_allowed },
  advertisesHistory = true,
) {
  const startChoice = {
    choice,
    choose: () => {},
    choices: [{ key: '3', label: '3 months', date: '2026-07-01' }],
    dateRange: {
      ...range,
      setFrom: () => {},
      setTo: () => {},
      getFromDisabledReason: () => null,
      getToDisabledReason: () => null,
      isFromDisabled: () => false,
      isToDisabled: () => false,
      crossed: range.from !== '' && range.to !== '' && range.from > range.to,
      reset: () => {},
    },
    start: range.from,
    end: null,
    uncoveredUntil: null,
    reset: () => {},
  } as unknown as StartChoiceState
  return renderToStaticMarkup(
    <StartStep
      range={RANGE}
      bankAccountName="Everyday Chequing"
      providerName="SimpleFIN"
      advertisesHistory={advertisesHistory}
      startChoice={startChoice}
      errors={errors}
      onRangeBlur={() => {}}
      disabled={false}
    />,
  )
}

describe('the start step', () => {
  it('shows the choice message beneath the list that the list points to, and gives the first choice the focus id', () => {
    const markup = renderStep({ startChoice: 'Choose where to start' }, null)

    expect(markup).toMatch(/<p id="bank-link-start-choice-error" role="alert"[^>]*>Choose where to start<\/p>/)
    expect(markup).toMatch(/role="radiogroup"[^>]*aria-describedby="bank-link-start-choice-error"/)
    expect(markup).toMatch(/<button id="bank-link-start-choice"[^>]*role="radio"/)
  })

  it('offers custom dates whose From and To show only once they are chosen, with the days allowed', () => {
    const unchosen = renderStep({}, null)
    const chosen = renderStep({})

    expect(unchosen).toContain('Custom dates')
    expect(unchosen).not.toContain('id="bank-link-range-from"')
    expect(chosen).toMatch(/role="group" aria-label="Custom dates"/)
    expect(chosen).toContain('id="bank-link-range-to"')
    expect(chosen).toContain('Any days from Oct 1, 2025 to today')
  })

  it('stays unmarked while nothing has been refused', () => {
    const markup = renderStep({}, CUSTOM_START, { from: '2020-01-01', to: RANGE.latest_allowed })

    expect(markup).not.toContain('role="alert"')
    expect(markup).not.toContain('aria-invalid="true"')
  })

  it('says a From after To on From at once, with From pointing at it', () => {
    const markup = renderStep({}, CUSTOM_START, { from: '2026-09-01', to: '2026-08-01' })

    expect(markup).toMatch(
      /<p id="bank-link-range-from-error" role="alert"[^>]*>Must be on or before the end date<\/p>/,
    )
    expect(markup).toMatch(
      /<input id="bank-link-range-from" aria-invalid="true" aria-describedby="bank-link-range-from-error"/,
    )
    expect(markup).not.toContain('id="bank-link-range-to-error"')
  })

  it('says syncing picks up from today when To is before today, and nothing of it when To is today', () => {
    const before = renderStep({}, CUSTOM_START, { from: '2026-03-01', to: '2026-05-31' })
    const today = renderStep({}, CUSTOM_START, { from: '2026-03-01', to: '2026-10-05' })

    expect(before).toContain('Syncing picks up from today. The days after May 31, 2026 stay as you entered them.')
    expect(today).not.toContain('Syncing picks up from today')
  })

  it("shows To's message once a press finds it missing", () => {
    const markup = renderStep({ rangeTo: 'Enter an end date' }, CUSTOM_START, { from: '2026-03-01', to: '' })

    expect(markup).toMatch(/<p id="bank-link-range-to-error" role="alert"[^>]*>Enter an end date<\/p>/)
  })

  it("says how far the provider reaches only when it doesn't promise each bank's history", () => {
    const note = 'SimpleFIN reaches back up to 12 months, but some banks keep less.'

    expect(renderStep({}, null, undefined, false)).toContain(note)
    expect(renderStep({}, null)).not.toContain(note)
  })
})
