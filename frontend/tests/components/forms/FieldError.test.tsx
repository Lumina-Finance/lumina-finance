/**
 * Guards that every label row a dialog field uses draws its problem through the one shared message, so a
 * screen reader announces it and the field can point to it, whichever feature folder the row lives in
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import CreateModalFieldLabelRow from '@/components/create-modal/FieldLabelRow'
import CreateModalSectionHeadingRow from '@/components/create-modal/SectionHeadingRow'
import { FormError } from '@/components/forms/FormError'
import BudgetEditorFieldLabelRow from '@/pages/budgets/components/shared/EditorFieldLabelRow'
import { AccountIdentityFieldLabelRow } from '@/pages/accounts/detail/components/edit-identity/controls/FieldLabelRow'

const MESSAGE = 'Name is required'

const ROWS: Record<string, (error: string | undefined) => React.ReactElement> = {
  'create-modal label row': (error) => (
    <CreateModalFieldLabelRow label="Name" htmlFor="name" error={error} errorId="name-error" />
  ),
  'create-modal section heading row': (error) => (
    <CreateModalSectionHeadingRow label="Name" error={error} errorId="name-error" />
  ),
  'budget editor label row': (error) => (
    <BudgetEditorFieldLabelRow label="Name" htmlFor="name" error={error} />
  ),
  'account edit label row': (error) => (
    <AccountIdentityFieldLabelRow label="Name" htmlFor="name" error={error} errorId="name-error" />
  ),
}

describe('field problems on a label row', () => {
  it.each(Object.entries(ROWS))('%s announces the message and gives it an id', (_name, render) => {
    const markup = renderToStaticMarkup(render(MESSAGE))
    expect(markup).toContain('role="alert"')
    expect(markup).toContain(MESSAGE)
    expect(markup).toMatch(/id="name-error"/)
  })

  it.each(Object.entries(ROWS))('%s draws nothing while the field is fine', (_name, render) => {
    const markup = renderToStaticMarkup(render(undefined))
    expect(markup).not.toContain('role="alert"')
  })
})

describe('a failure that belongs to no field', () => {
  it('is announced, and draws nothing without a message', () => {
    expect(renderToStaticMarkup(<FormError message="Could not save" />)).toContain('role="alert"')
    expect(renderToStaticMarkup(<FormError message={null} />)).toBe('')
  })
})
