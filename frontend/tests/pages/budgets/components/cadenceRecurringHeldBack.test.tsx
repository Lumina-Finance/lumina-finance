/**
 * Guards the Recurring option in the budget dialogues' Type control. When a reason holds it back, it
 * must stay focusable and marked unavailable, so the reason reaches the pointer, the keyboard and a
 * screen reader
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
  recurrenceFreq: 'weekly',
  instanceLength: '1',
  periodStart: '1996-05-06',
  recurs: false,
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

/** The opening tag of the Recurring option, drawn with the given reason and lock */
function recurringTag(reason: string | undefined, fieldsLocked = false) {
  const markup = renderToStaticMarkup(
    <BudgetEditorModalCadenceSection
      state={{ form: FORM, categorySearch: '' }}
      ids={IDS}
      periodStartLabel="Period start"
      recurrenceControlsLocked
      fieldsLocked={fieldsLocked}
      recurringUnavailableReason={reason}
      showError={() => undefined}
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
  const tag = markup.match(/<button[^>]*>Recurring<\/button>/)?.[0]
  if (!tag) throw new Error('No Recurring option was drawn')
  return tag
}

describe('Recurring option held back by a reason', () => {
  it('stays focusable and marked unavailable while a reason holds it back', () => {
    const tag = recurringTag("This budget can't repeat: a budget can go back at most 1,200 periods.")
    expect(tag).toContain('aria-disabled="true"')
    expect(tag).not.toMatch(/\sdisabled=""/)
  })

  it('is an ordinary option with no reason', () => {
    expect(recurringTag(undefined)).not.toContain('aria-disabled')
  })

  it('stays disabled outright on an archived budget, whatever the reason', () => {
    const tag = recurringTag("This budget can't repeat: a budget can go back at most 1,200 periods.", true)
    expect(tag).toMatch(/\sdisabled=""/)
    expect(tag).not.toContain('aria-disabled')
  })
})
