/**
 * Covers the import the Bank link section shows as its link's reads arrive, which stays a moment as
 * done once the link stops reporting it
 *
 * These tests catch an import cut short by its bank account needing to be chosen again reading as
 * imported and done just before the notice asking for that choice, and a finished import dropped
 * without being shown as done
 */
import { useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { BankLink } from '@/api/bank-sync'
import { ImportProgress } from '@/pages/accounts/detail/components/bank-link/ImportProgress'
import { useLingeringImport } from '@/pages/accounts/detail/components/bank-link/useLingeringImport'
import { createImport, createLink, createSync } from './fixtures'

/**
 * Shows the import the section would after each read in turn, each read the next poll's answer.
 * Rendered on the server, where nothing re-renders, so the reads are stepped through within the one
 * render instead, and no effect runs to fold a done import away before it is read
 */
function ShownImport({ reads }: { reads: BankLink[] }) {
  const [step, setStep] = useState(0)
  if (step < reads.length - 1) setStep(step + 1)
  const shown = useLingeringImport(reads[step].import, reads[step].state)
  return shown && <ImportProgress progress={shown} />
}

function renderAfter(...reads: BankLink[]): string {
  return renderToStaticMarkup(<ShownImport reads={reads} />).replaceAll('<!-- -->', '')
}

// An import from Jun 1 halfway through, then the next read of the same link
const importing = createLink({
  import: createImport(),
  sync: createSync({ state: 'importing', last_success_at: null }),
})

describe('useLingeringImport', () => {
  it('drops a running import without reading as done once its link must have its bank account chosen again', () => {
    const markup = renderAfter(
      importing,
      createLink({ state: 'choose_account', sync: createSync({ state: 'choose_account' }) }),
    )

    expect(markup).toBe('')
  })

  it('holds a finished import as done, all its windows stored', () => {
    const markup = renderAfter(importing, createLink())

    expect(markup).toContain('Imported from Jun 1, 2026')
    expect(markup).toContain('12 found · Done')
    expect(markup).toMatch(/role="progressbar"[^>]*aria-valuemax="2"[^>]*aria-valuenow="2"/)
  })
})
