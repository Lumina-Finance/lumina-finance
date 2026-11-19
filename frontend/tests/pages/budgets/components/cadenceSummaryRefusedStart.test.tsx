/**
 * Guards the cadence line under a new budget's start date. It must not name a start date the field
 * refuses, since that would describe a budget that can't be saved
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// The date field reads the signed-in user's time zone. The markup does not depend on it
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }))

// The calendar is portalled into the document body. A server render has no body
vi.mock('@/components/date-field/CalendarPopover', () => ({ default: () => null }))

import BudgetEditorModalCadenceSection from '@/pages/budgets/components/budget-editor-modal/sections/CadenceSection'
import type { BudgetFormState } from '@/pages/budgets/types'

const FORM: BudgetFormState = {
  name: 'Groceries',
  currency: 'CAD',
  categoryIds: [],
  limit: '500',
  recurrenceFreq: 'monthly',
  instanceLength: '1',
  periodStart: '1899-12-31',
  recurs: true,
}

const IDS = {
  name: 'name',
  currency: 'currency',
  limit: 'limit',
  interval: 'interval',
  recurrenceType: 'recurrence-type',
  frequency: 'frequency',
  periodStart: 'period-start',
  categorySearch: 'category-search',
}

function drawCadence(startError: string | undefined) {
  return renderToStaticMarkup(
    <BudgetEditorModalCadenceSection
      state={{ form: FORM, categorySearch: '' }}
      ids={IDS}
      periodStartLabel="Start date"
      recurrenceControlsLocked={false}
      fieldsLocked={false}
      showError={(field) => (field === 'periodStart' ? startError : undefined)}
      handlers={{
        onClose: () => undefined,
        onSubmit: () => undefined,
        setField: () => undefined,
        onRecursChange: () => undefined,
        onCategorySearchChange: () => undefined,
        onCategoryToggle: () => undefined,
        onBlur: () => undefined,
      }}
    />,
  )
}

describe('cadence line under the budget start date', () => {
  it('names the start date while the field accepts it', () => {
    expect(drawCadence(undefined)).toContain('will repeat monthly starting Dec 31, 1899')
  })

  it('leaves out a start date the field refuses', () => {
    const markup = drawCadence('Must be on or after Jan 1, 1900')

    expect(markup).toContain('will repeat monthly starting the selected start date')
    expect(markup).not.toContain('starting Dec 31, 1899')
  })
})
