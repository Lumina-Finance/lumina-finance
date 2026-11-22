/**
 * Tests how the import budgets step shows the wait for the count of the person's budgets: a neutral status
 * while it loads, and an error with a Try again button when it could not be read
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ImportBudgetStep } from '@/pages/imports/sections/ImportBudgetStep'
import { getProviderBudgetSelectionError, type BudgetCountCheck } from '@/pages/imports/utils/providerImportRun'

/** Renders the step with an export that holds no budgets, so only the selection line is under test */
function renderStep(selectionCheck: BudgetCountCheck, selectionError: string | null, isRetryingSelectionCheck = false) {
  const props = {
    description: 'Budgets',
    detectedCount: 0,
    skippedHeaders: [],
    skippedAmountHeaders: [],
    skippedRows: [],
    selectionError,
    selectionCheck,
    onRetrySelectionCheck: () => undefined,
    isRetryingSelectionCheck,
    noBudgetsDescription: 'None',
    allSkippedDescription: 'All skipped',
    budgets: [],
  }
  return renderToStaticMarkup(<ImportBudgetStep {...(props as unknown as Parameters<typeof ImportBudgetStep>[0])} />)
}

describe('the import budgets step while it waits on the count of budgets', () => {
  it('shows the wait as a neutral status line with no retry button', () => {
    const message = getProviderBudgetSelectionError([{ name: 'A', categoryCount: 1 }], null, false, null)
    const markup = renderStep('checking', message)

    expect(markup).toContain('role="status"')
    expect(markup).toContain('Checking how many budgets you already have.')
    expect(markup).not.toContain('role="alert"')
    expect(markup).not.toContain('Try again')
  })

  it('shows a failure as an error with a Try again button', () => {
    const message = getProviderBudgetSelectionError([{ name: 'A', categoryCount: 1 }], null, true, null)
    const markup = renderStep('failed', message)

    expect(markup).toContain('role="alert"')
    expect(markup).toContain('Your budgets couldn&#x27;t be loaded')
    expect(markup).toContain('>Try again</button>')
    expect(markup).not.toContain('role="status"')
  })

  it('marks the retry busy and relabels it while the count is asked for again', () => {
    const message = getProviderBudgetSelectionError([{ name: 'A', categoryCount: 1 }], null, true, null)
    const markup = renderStep('failed', message, true)

    expect(markup).toContain('aria-disabled="true"')
    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('>Retrying…</button>')
    expect(markup).not.toContain('>Try again</button>')
  })

  it('leaves the retry ready while nothing is being asked for', () => {
    const markup = renderStep('failed', 'Could not load', false)

    expect(markup).toContain('aria-busy="false"')
    expect(markup).toContain('>Try again</button>')
    expect(markup).not.toContain('Retrying')
  })

  it('shows a limit refusal as an error without a retry button', () => {
    const markup = renderStep(null, 'Please select at most 1 budget to import')

    expect(markup).toContain('role="alert"')
    expect(markup).not.toContain('Try again')
  })
})
