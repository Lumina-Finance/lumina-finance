/**
 * Guards every toggle switch in the app being the shared Switch, whose stylesheet rules give its track a
 * hover look and keyboard focus the shared ring. A switch drawn by hand again would have neither
 */
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Switch } from '@/components/forms/Switch'
import { AccountArchiveSection } from '@/pages/accounts/detail/components/edit-identity/sections/ArchiveSection'
import BudgetEditorModalArchiveSection from '@/pages/budgets/components/budget-editor-modal/sections/ArchiveSection'

const MODALS_FOLDER = '../../../src/pages/settings/components/tax-advantaged/tax-advantaged-categories-section/modals/'

function expectSharedSwitch(markup: string) {
  expect(markup).toMatch(/<span class="app-switch"><input[^>]*role="switch"/)
}

describe('toggle switch', () => {
  it('renders a checkbox with the switch role inside the switch wrapper', () => {
    expectSharedSwitch(renderToStaticMarkup(<Switch id="x" checked={false} onChange={() => {}} />))
  })

  it('is the switch of the account archive section', () => {
    expectSharedSwitch(renderToStaticMarkup(
      <AccountArchiveSection
        sectionNumber="02"
        isArchived={false}
        isArchiving={false}
        isArchiveBlocked={false}
        currentBalance={0}
        currency="CAD"
        onToggle={() => {}}
      />,
    ))
  })

  it('is the switch of the budget archive section', () => {
    expectSharedSwitch(renderToStaticMarkup(<BudgetEditorModalArchiveSection isArchived={false} onToggle={() => {}} />))
  })

  // These two modals open through a portal and a form hook that static rendering can't run, so the
  // switch they draw is found in their source
  it.each(['CreateCategoryModal.tsx', 'CategoryDetailsModal.tsx'])('is the switch of %s', (file) => {
    const source = readFileSync(new URL(MODALS_FOLDER + file, import.meta.url), 'utf8')
    expect(source).toContain('<Switch')
    expect(source).not.toContain('role="switch"')
  })
})
